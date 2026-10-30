import { existsSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/staged/config.js";
import { runStaged } from "../src/staged/index.js";
import { FAIL, FMT, MARK, RESET, createRepo } from "./helpers.js";

const repos = [];
function repo(files, options) {
  const r = createRepo(
    { "fmt.js": FMT, "fail.js": FAIL, "reset.js": RESET, "mark.js": MARK, ...files },
    options,
  );
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

function run(r, options = {}) {
  return runStaged({ cwd: r.dir, quiet: true, stream: new PassThrough(), ...options });
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return [].concat(error).map(String).join("\n");
  }
  throw new Error("expected runStaged to reject");
}

const FMT_JS = { "*.js": "node fmt.js" };

describe("runStaged", () => {
  it("runs commands only on matching staged files", async () => {
    const r = repo({ "a.js": "one\n", "b.css": "two\n" });
    r.write("a.js", "uno\n");
    r.write("b.css", "dos\n");
    r.git("add", "a.js", "b.css");

    await run(r, { config: FMT_JS });

    expect(r.git("show", ":a.js")).toBe("UNO\n");
    expect(r.git("show", ":b.css")).toBe("dos\n");
    expect(r.read("b.css")).toBe("dos\n");
  });

  it("re-adds formatter-modified files to the index", async () => {
    const r = repo({ "a.js": "one\n" });
    r.write("a.js", "uno\n");
    r.git("add", "a.js");

    await run(r, { config: FMT_JS });

    expect(r.git("diff", "--name-only")).toBe("");
    expect(r.git("diff", "--cached", "--name-only")).toBe("a.js\n");
  });

  it("keeps unstaged hunks of partially staged files", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.write("a.js", "uno\ntwo\nthree\n");
    r.git("add", "a.js");
    r.write("a.js", "uno\ntwo\ntres\n");

    await run(r, { config: FMT_JS });

    expect(r.git("show", ":a.js")).toBe("UNO\ntwo\nthree\n");
    expect(r.read("a.js")).toBe("UNO\ntwo\ntres\n");
  });

  it("rolls back everything when a command fails", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.write("a.js", "uno\ntwo\nthree\n");
    r.git("add", "a.js");
    r.write("a.js", "uno\ntwo\ntres\n");
    const before = {
      status: r.git("status", "--porcelain"),
      index: r.git("show", ":a.js"),
      file: r.read("a.js"),
    };

    await failure(run(r, { config: { "*.js": ["node fmt.js", "node fail.js"] } }));

    expect(r.git("status", "--porcelain")).toBe(before.status);
    expect(r.git("show", ":a.js")).toBe(before.index);
    expect(r.read("a.js")).toBe(before.file);
  });

  it("prevents an empty commit unless allowEmpty", async () => {
    const r = repo({ "a.js": "x\n" });
    r.write("a.js", "y\n");
    r.git("add", "a.js");
    const config = { "*.js": "node reset.js" };

    expect(await failure(run(r, { config }))).toContain("Prevented an empty git commit");

    r.write("a.js", "y\n");
    r.git("add", "a.js");
    await run(r, { config, allowEmpty: true });
  });

  it("does nothing when no staged file matches", async () => {
    const r = repo({ "a.css": "one\n" });
    r.write("a.css", "uno\n");
    r.git("add", "a.css");

    await run(r, { config: { "*.js": "node mark.js" } });

    expect(existsSync(join(r.dir, "marker"))).toBe(false);
  });

  it("rejects with a config message when no config exists", async () => {
    const r = repo({ "a.js": "one\n" });
    r.write("a.js", "uno\n");
    r.git("add", "a.js");

    expect(await failure(run(r))).toMatch(/Create Nano Staged config/);
  });

  it("supports function values in a JS config", async () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-staged.mjs": `export default { "*.js": ({ filenames }) => ["node fmt.js " + filenames.join(" ")] };\n`,
    });
    r.write("a.js", "uno\n");
    r.git("add", "a.js");

    await run(r);

    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("only processes files under cwd in a sub-package", async () => {
    const r = repo({
      "packages/a/.nano-staged.json": JSON.stringify(FMT_JS),
      "packages/a/x.js": "one\n",
      "packages/b/y.js": "two\n",
    });
    r.write("packages/a/x.js", "uno\n");
    r.write("packages/b/y.js", "dos\n");
    r.git("add", "-A");

    await run(r, { cwd: join(r.dir, "packages/a") });

    expect(r.git("show", ":packages/a/x.js")).toBe("UNO\n");
    expect(r.git("show", ":packages/b/y.js")).toBe("dos\n");
  });

  it("does nothing for a deletion-only commit", async () => {
    const r = repo({ "a.js": "one\n" });
    r.git("rm", "-q", "a.js");

    await run(r, { config: { "*.js": "node mark.js" } });

    expect(existsSync(join(r.dir, "marker"))).toBe(false);
    expect(r.git("ls-files", "a.js")).toBe("");
  });

  it("formats the new path of a rename-only commit", async () => {
    const r = repo({ "a.js": "one\n" });
    r.git("mv", "a.js", "c.js");

    await run(r, { config: FMT_JS });

    expect(r.git("show", ":c.js")).toBe("ONE\n");
    expect(r.git("ls-files", "a.js")).toBe("");
  });

  it("works when cwd is not the canonical path (symlink, Windows short name)", async () => {
    const r = repo({ "a.js": "one\n" });
    const link = join(dirname(r.dir), "link");
    symlinkSync(r.dir, link, "junction");
    r.write("a.js", "uno\n");
    r.git("add", "a.js");

    await run(r, { cwd: link, config: FMT_JS });

    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("passes filenames with spaces as single arguments", async () => {
    const r = repo({ "my file.js": "one\n" });
    r.write("my file.js", "uno\n");
    r.git("add", "my file.js");

    await run(r, { config: FMT_JS });

    expect(r.git("show", ":my file.js")).toBe("UNO\n");
  });
});

describe("runStaged conflicts and bad configs", () => {
  it("reports a merge conflict when unstaged changes cannot be restored", async () => {
    const r = repo({ "a.js": "one\ntwo\nthree\n" });
    r.write("a.js", "uno\ntwo\nthree\n");
    r.git("add", "a.js");
    r.write("a.js", "uno-x\ntwo\nthree\n");

    expect(await failure(run(r, { config: FMT_JS }))).toContain("Merge conflict");
    expect(r.read("a.js")).toContain("uno-x");
  });

  it("rejects with the file name when the config cannot be parsed", async () => {
    const r = repo({ "a.js": "one\n", ".nano-staged.json": "{ not json" });
    r.write("a.js", "uno\n");
    r.git("add", "a.js");

    expect(await failure(run(r))).toContain(".nano-staged.json");
  });
});

describe("getConfig", () => {
  it("follows nano-staged precedence", async () => {
    const r = repo({
      ".nano-staged.json": JSON.stringify({ "*.js": "a" }),
      "package.json": JSON.stringify({ "nano-staged": { "*.css": "b" } }),
    });

    expect(await getConfig(r.dir)).toEqual({ "*.js": "a" });
  });
});
