import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runWithBackup } from "../src/backup.js";
import { createGit } from "../src/git.js";
import { FMT, createRepo } from "./helpers.js";

const repos = [];
function repo(files) {
  const r = createRepo({ "fmt.js": FMT, ...files });
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

const patchPaths = (r) => ({
  original: join(r.dir, ".git", "nano-hooks.patch"),
  unstaged: join(r.dir, ".git", "nano-hooks_partial.patch"),
});

/** Run `execute` inside the workflow for the staged files of `r`. */
async function work(r, execute, options = {}) {
  const git = createGit(r.dir);
  const files = await git.stagedFiles();
  const steps = [];
  const promise = runWithBackup({
    rootPath: r.dir,
    dotPath: join(r.dir, ".git"),
    files,
    execute: { tasks: [], run: execute },
    onStep: (step) => steps.push(step),
    ...options,
  });
  return { promise, steps };
}

/** The errors that the workflow rejected with. */
async function errorsOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AggregateError ? error.errors : [error];
  }
  throw new Error("expected the workflow to reject");
}

/** Stage `a.js` with one hunk and leave a second, unstaged hunk in the worktree. */
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

    const { promise, steps } = await work(r, async () => r.write("a.js", "UNO\ntwo\nthree\n"));
    await promise;

    expect(r.git("show", ":a.js")).toBe("UNO\ntwo\nthree\n");
    expect(r.read("a.js")).toBe("UNO\ntwo\ntres\n");
    expect(r.read("b.js")).toBe("untouched change\n");
    expect(existsSync(patchPaths(r).original)).toBe(false);
    expect(existsSync(patchPaths(r).unstaged)).toBe(false);
    expect(steps.map((step) => step.state)).toEqual(Array(steps.length).fill("done"));
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
      "Cleaning up temporary patch files",
    ]);
  });

  it("restores the original index and worktree and removes the patches when a task fails", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n", "b.js": "keep\n" });
    partiallyStage(r);
    r.write("b.js", "unrelated change\n");
    const before = {
      status: r.git("status", "--porcelain"),
      index: r.git("ls-files", "--stage"),
      a: r.read("a.js"),
    };

    const { promise } = await work(r, async () => {
      r.write("a.js", "garbage\n");
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
  });

  it("keeps the patches and reports both errors when the rollback fails", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);

    const { promise } = await work(r, async () => {
      // A held index lock makes every later git command that writes the index fail.
      writeFileSync(join(r.dir, ".git", "index.lock"), "");
      throw new Error("task failed");
    });
    const messages = (await errorsOf(promise)).map((error) => error.message);
    rmSync(join(r.dir, ".git", "index.lock"));

    expect(messages[0]).toBe("task failed");
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain(patchPaths(r).original);
    expect(messages[2]).toContain(patchPaths(r).unstaged);
    expect(existsSync(patchPaths(r).original)).toBe(true);
    expect(existsSync(patchPaths(r).unstaged)).toBe(true);
  });

  it("keeps the patches when the unstaged changes cannot be restored", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.write("a.js", "uno-x\ntwo\nthree\n");
    r.git("add", "a.js");
    r.write("a.js", "uno\ntwo\nthree\n");

    const { promise, steps } = await work(r, async () => r.write("a.js", "UNO-X\ntwo\nthree\n"));
    const messages = (await errorsOf(promise)).map((error) => error.message);

    expect(messages[0]).toContain("A merge conflict occurred");
    expect(messages[1]).toContain(patchPaths(r).unstaged);
    expect(existsSync(patchPaths(r).original)).toBe(true);
    expect(existsSync(patchPaths(r).unstaged)).toBe(true);
    expect(steps.map((step) => step.title)).not.toContain("Cleaning up temporary patch files");
  });

  it("reports a cleanup failure next to the earlier errors", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    partiallyStage(r);

    const { promise } = await work(r, async () => {
      // A directory cannot be removed like a patch file.
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
      async () => {
        ran = true;
      },
      { dotPath: join(r.dir, "missing") },
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

    const { promise, steps } = await work(r, async () => {
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
    const reset = async () => r.write("a.js", "x\n");

    const first = await work(r, reset);
    expect((await errorsOf(first.promise))[0].message).toContain("The commit would be empty");
    expect(r.git("show", ":a.js")).toBe("y\n");

    const second = await work(r, reset, { allowEmpty: true });
    await second.promise;
  });
});
