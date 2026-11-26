import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runWithBackup } from "../src/lib/backup.js";
import { createGit } from "../src/lib/git.js";
import { FMT, nanoWith, testRepo } from "./helpers.js";

const repo = (files) => testRepo({ "fmt.js": FMT, ...files });

const patchPaths = (r) => ({
  original: join(r.dir, ".git", "nano-hooks.patch"),
  unstaged: join(r.dir, ".git", "nano-hooks_partial.patch"),
  index: join(r.dir, ".git", "nano-hooks.index"),
});

async function work(r, execute, options = {}) {
  const git = createGit(r.dir);
  const files = await git.stagedFiles();
  const steps = [];
  const promise = runWithBackup({
    rootPath: r.dir,
    gitDir: join(r.dir, ".git"),
    files,
    execute: { tasks: [], run: execute },
    onStep: (step) => steps.push(step),
    ...options,
  });
  return { promise, steps };
}

async function errorsOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AggregateError ? error.errors : [error];
  }
  throw new Error("expected the workflow to reject");
}

function partiallyStage(r) {
  r.write("a.js", "uno\ntwo\nthree\n");
  r.git("add", "a.js");
  r.write("a.js", "uno\ntwo\ntres\n");
}

describe("runWithBackup", () => {
  it("stages task edits, restores unstaged changes and removes the patches", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n", "b.js": "keep\n" });
    partiallyStage(r);
    r.write("b.js", "untouched change\n");

    const { promise, steps } = await work(r, () => r.write("a.js", "UNO\ntwo\nthree\n"));
    await promise;

    expect(r.git("show", ":a.js")).toBe("UNO\ntwo\nthree\n");
    expect(r.read("a.js")).toBe("UNO\ntwo\ntres\n");
    expect(r.read("b.js")).toBe("untouched change\n");
    expect(existsSync(patchPaths(r).original)).toBe(false);
    expect(existsSync(patchPaths(r).unstaged)).toBe(false);
    expect(existsSync(patchPaths(r).index)).toBe(false);
    expect(steps.map((step) => step.state)).toEqual(steps.map(() => "done"));
  });

  it("reports each step to the observer in order", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);

    const { promise, steps } = await work(r, async () => {});
    await promise;

    expect(steps.map((step) => step.title)).toEqual([
      "Preparing nano-hooks",
      "Backing up unstaged changes for staged files",
      "Running tasks for staged files",
      "Applying modifications from tasks",
      "Restoring unstaged changes for staged files",
      "Cleaning up recovery files",
    ]);
  });

  it("restores the original index and worktree when a task stages changes and fails", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n", "b.js": "keep\n" });
    partiallyStage(r);
    r.write("b.js", "unrelated change\n");
    const before = {
      status: r.git("status", "--porcelain"),
      index: r.git("ls-files", "--stage"),
      a: r.read("a.js"),
    };

    const { promise } = await work(r, () => {
      r.write("a.js", "garbage\n");
      r.git("add", "a.js", "b.js");
      throw new Error("task failed");
    });
    const errors = await errorsOf(promise);

    expect(errors.map((error) => error.message)).toEqual(["task failed"]);
    expect(r.git("status", "--porcelain")).toBe(before.status);
    expect(r.git("ls-files", "--stage")).toBe(before.index);
    expect(r.read("a.js")).toBe(before.a);
    expect(r.read("b.js")).toBe("unrelated change\n");
    expect(existsSync(patchPaths(r).original)).toBe(false);
    expect(existsSync(patchPaths(r).unstaged)).toBe(false);
    expect(existsSync(patchPaths(r).index)).toBe(false);
  });

  it("backs up a split index without relying on its shared index file", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.git("config", "core.splitIndex", "true");
    r.git("update-index", "--split-index");
    partiallyStage(r);
    const original = r.git("ls-files", "--stage");
    const shared = resolve(r.dir, r.git("rev-parse", "--shared-index-path").trim());
    expect(existsSync(shared)).toBe(true);

    const { promise } = await work(r, () => {
      r.write("a.js", "task change\n");
      r.git("add", "a.js");
      rmSync(shared);
      throw new Error("task failed");
    });

    expect((await errorsOf(promise)).map((error) => error.message)).toEqual(["task failed"]);
    expect(r.git("ls-files", "--stage")).toBe(original);
    expect(r.read("a.js")).toBe("uno\ntwo\ntres\n");
  });

  it("restores the active alternate index", () => {
    const r = repo({
      "a.js": "one\ntwo\nthree\n",
      ".nano-hooks.json": JSON.stringify({
        staged: { "a.js": "node fail.js" },
      }),
      "fail.js": `require("node:fs").writeFileSync("a.js", "task change\\n");
require("node:child_process").execFileSync("git", ["add", "a.js"]);
process.exit(1);`,
    });
    const env = { GIT_INDEX_FILE: join(r.dir, ".git", "alternate-index") };
    const git = (...args) =>
      execFileSync("git", args, { cwd: r.dir, env: { ...process.env, ...env }, encoding: "utf8" });
    git("read-tree", "HEAD");
    r.write("a.js", "uno\ntwo\nthree\n");
    git("add", "a.js");
    r.write("a.js", "uno\ntwo\ntres\n");

    const result = nanoWith(r, { env }, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Restoring to original state because of errors");
    expect(git("show", ":a.js")).toBe("uno\ntwo\nthree\n");
    expect(r.git("show", ":a.js")).toBe("one\ntwo\nthree\n");
    expect(r.read("a.js")).toBe("uno\ntwo\ntres\n");
  });

  it("keeps the patches and reports both errors when the rollback fails", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);

    const { promise } = await work(r, () => {
      writeFileSync(join(r.dir, ".git", "index.lock"), "other writer");
      throw new Error("task failed");
    });
    const messages = (await errorsOf(promise)).map((error) => error.message);
    expect(readFileSync(join(r.dir, ".git", "index.lock"), "utf8")).toBe("other writer");

    expect(messages[0]).toBe("task failed");
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain(patchPaths(r).original);
    expect(messages[2]).toContain(patchPaths(r).unstaged);
    expect(messages[2]).toContain(patchPaths(r).index);
    expect(existsSync(patchPaths(r).original)).toBe(true);
    expect(existsSync(patchPaths(r).unstaged)).toBe(true);
    expect(existsSync(patchPaths(r).index)).toBe(true);
  });

  it("keeps the patches when the unstaged changes cannot be restored", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.write("a.js", "uno-x\ntwo\nthree\n");
    r.git("add", "a.js");
    r.write("a.js", "uno\ntwo\nthree\n");

    const { promise, steps } = await work(r, () => r.write("a.js", "UNO-X\ntwo\nthree\n"));
    const messages = (await errorsOf(promise)).map((error) => error.message);

    expect(messages[0]).toContain("A merge conflict occurred");
    expect(messages[1]).toContain(patchPaths(r).unstaged);
    expect(existsSync(patchPaths(r).original)).toBe(true);
    expect(existsSync(patchPaths(r).unstaged)).toBe(true);
    expect(steps.map((step) => step.title)).not.toContain("Cleaning up recovery files");
  });

  it("reports a cleanup failure next to the earlier errors", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);

    const { promise } = await work(r, () => {
      rmSync(patchPaths(r).unstaged);
      mkdirSync(join(patchPaths(r).unstaged, "x"), { recursive: true });
      throw new Error("task failed");
    });
    const messages = (await errorsOf(promise)).map((error) => error.message);

    expect(messages[0]).toBe("task failed");
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain("nano-hooks_partial.patch");
  });

  it("runs no task and keeps no patch when the first backup fails", async () => {
    const r = repo({ "a.js": "one\n" });
    r.write("a.js", "uno\n");
    r.git("add", "a.js");
    let ran = false;

    const { promise, steps } = await work(
      r,
      () => {
        ran = true;
      },
      { gitDir: join(r.dir, "missing") },
    );
    await errorsOf(promise);

    expect(ran).toBe(false);
    expect(steps.map((step) => step.title)).toEqual(["Preparing nano-hooks"]);
    expect(r.git("diff", "--cached", "--name-only")).toBe("a.js\n");
    expect(existsSync(join(r.dir, ".git", "nano-hooks.patch"))).toBe(false);
  });

  it("stops before it changes anything when recovery patches already exist", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);
    writeFileSync(patchPaths(r).unstaged, "earlier run");
    const status = r.git("status", "--porcelain");
    const worktree = r.read("a.js");
    let ran = false;

    const { promise, steps } = await work(r, () => {
      ran = true;
    });
    const [error] = await errorsOf(promise);

    expect(error.message).toContain(patchPaths(r).unstaged);
    expect(ran).toBe(false);
    expect(steps).toEqual([]);
    expect(r.git("status", "--porcelain")).toBe(status);
    expect(r.read("a.js")).toBe(worktree);
    expect(existsSync(patchPaths(r).unstaged)).toBe(true);
    expect(existsSync(patchPaths(r).original)).toBe(false);
  });

  it("prevents an empty commit unless allowEmpty", async () => {
    const r = repo({ "a.js": "x\n" });
    r.write("a.js", "y\n");
    r.git("add", "a.js");
    const reset = () => r.write("a.js", "x\n");

    const first = await work(r, reset);
    expect((await errorsOf(first.promise))[0].message).toContain("The commit would be empty");
    expect(r.git("show", ":a.js")).toBe("y\n");

    const second = await work(r, reset, { allowEmpty: true });
    await second.promise;
  });

  it("ignores unrelated unstaged changes when it checks for an empty commit", async () => {
    const r = repo({ "a.js": "x\n", "b.js": "keep\n" });
    r.write("a.js", "y\n");
    r.git("add", "a.js");
    r.write("b.js", "unrelated unstaged edit\n");
    const reset = () => r.write("a.js", "x\n");

    const { promise } = await work(r, reset);

    expect((await errorsOf(promise))[0].message).toContain("The commit would be empty");
    expect(r.git("show", ":a.js")).toBe("y\n");
    expect(r.read("b.js")).toBe("unrelated unstaged edit\n");
  });

  it("still sees the staged deletion of another file as a change", async () => {
    const r = repo({ "a.js": "x\n", "b.js": "keep\n" });
    r.write("a.js", "y\n");
    r.git("add", "a.js");
    r.git("rm", "-q", "b.js");
    const reset = () => r.write("a.js", "x\n");

    const { promise } = await work(r, reset);
    await promise;

    expect(r.git("diff", "--cached", "--name-status").trim()).toBe("D\tb.js");
  });
});
