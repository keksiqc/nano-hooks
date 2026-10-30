import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { install, uninstall } from "../src/hooks.js";
import { FMT, createRepo, createTempDir } from "./helpers.js";

const cleanups = [];
function repo(config = {}, options) {
  const r = createRepo({ ".nano-hooks.json": JSON.stringify(config) }, options);
  cleanups.push(r.cleanup);
  return r;
}
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

const hookPath = (r, name) => join(r.dir, ".git", "hooks", name);
const commit = (r, env = {}) =>
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "x"], {
    cwd: r.dir,
    env: { ...process.env, ...env },
    stdio: "pipe",
  });

describe("install", () => {
  it("writes an executable managed script for each configured hook", async () => {
    const r = repo({ "pre-commit": "echo hello", "commit-msg": "echo msg $1" });

    const result = await install({ cwd: r.dir });

    expect(result.installed.sort()).toEqual(["commit-msg", "pre-commit"]);
    const script = readFileSync(hookPath(r, "pre-commit"), "utf8");
    expect(script.startsWith("#!/bin/sh\n# nano-hooks: managed file")).toBe(true);
    expect(script).toContain("echo hello");
    // Windows has no executable bit; git for Windows runs the script through sh anyway.
    if (process.platform !== "win32") {
      expect(statSync(hookPath(r, "pre-commit")).mode & 0o111).toBe(0o111);
    }
  });

  it("auto-wires pre-commit to the staged runner when a staged config exists", async () => {
    const r = repo();
    writeFileSync(join(r.dir, ".nano-staged.json"), JSON.stringify({ "*.js": "echo" }));

    await install({ cwd: r.dir });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toMatch(/cli\.js'? staged/);
  });

  it("does not auto-wire when pre-commit is configured", async () => {
    const r = repo({ "pre-commit": "echo mine" });
    writeFileSync(join(r.dir, ".nano-staged.json"), JSON.stringify({ "*.js": "echo" }));

    await install({ cwd: r.dir });

    const script = readFileSync(hookPath(r, "pre-commit"), "utf8");
    expect(script).toContain("echo mine");
    expect(script).not.toContain(" staged");
  });

  it("runs the hook on commit", async () => {
    const r = repo({ "pre-commit": "touch ran" });
    await install({ cwd: r.dir });

    commit(r);

    expect(existsSync(join(r.dir, "ran"))).toBe(true);
  });

  it("SKIP_NANO_HOOKS=1 skips the hook", async () => {
    const r = repo({ "pre-commit": "touch ran" });
    await install({ cwd: r.dir });

    commit(r, { SKIP_NANO_HOOKS: "1" });

    expect(existsSync(join(r.dir, "ran"))).toBe(false);
  });

  it("exposes node_modules/.bin on PATH inside the hook", async () => {
    const r = repo({ "pre-commit": "hello" });
    mkdirSync(join(r.dir, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(r.dir, "node_modules/.bin/hello"), "#!/bin/sh\ntouch hello-ran\n");
    chmodSync(join(r.dir, "node_modules/.bin/hello"), 0o755);
    await install({ cwd: r.dir });

    commit(r);

    expect(existsSync(join(r.dir, "hello-ran"))).toBe(true);
  });

  it("leaves an unmanaged hook untouched and reports it in skipped", async () => {
    const r = repo({ "pre-commit": "echo ours" });
    mkdirSync(join(r.dir, ".git/hooks"), { recursive: true });
    writeFileSync(hookPath(r, "pre-commit"), "#!/bin/sh\necho mine\n");

    const result = await install({ cwd: r.dir });

    expect(result.skipped).toEqual(["pre-commit"]);
    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toBe("#!/bin/sh\necho mine\n");
  });

  it("removes managed hooks that are no longer configured", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b" });
    await install({ cwd: r.dir });
    writeFileSync(join(r.dir, ".nano-hooks.json"), JSON.stringify({ "pre-commit": "echo a" }));

    const result = await install({ cwd: r.dir });

    expect(result.removed).toEqual(["commit-msg"]);
    expect(existsSync(hookPath(r, "commit-msg"))).toBe(false);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("preserveUnused: true keeps unconfigured managed hooks", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b" });
    await install({ cwd: r.dir });
    writeFileSync(
      join(r.dir, ".nano-hooks.json"),
      JSON.stringify({ "pre-commit": "echo a", preserveUnused: true }),
    );

    await install({ cwd: r.dir });

    expect(existsSync(hookPath(r, "commit-msg"))).toBe(true);
  });

  it("preserveUnused: [name] keeps only that hook", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b", "pre-push": "echo c" });
    await install({ cwd: r.dir });
    writeFileSync(
      join(r.dir, ".nano-hooks.json"),
      JSON.stringify({ "pre-commit": "echo a", preserveUnused: ["commit-msg"] }),
    );

    await install({ cwd: r.dir });

    expect(existsSync(hookPath(r, "commit-msg"))).toBe(true);
    expect(existsSync(hookPath(r, "pre-push"))).toBe(false);
  });

  it("is idempotent", async () => {
    const r = repo({ "pre-commit": "echo a" });
    await install({ cwd: r.dir });
    const first = readFileSync(hookPath(r, "pre-commit"), "utf8");

    await install({ cwd: r.dir });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toBe(first);
  });

  it("honors core.hooksPath", async () => {
    const r = repo({ "pre-commit": "echo a" });
    r.git("config", "core.hooksPath", ".githooks");

    await install({ cwd: r.dir });

    expect(existsSync(join(r.dir, ".githooks/pre-commit"))).toBe(true);
  });

  it("installs into the shared hooks dir from a linked worktree", async () => {
    const r = repo({ "pre-commit": "echo a" });
    const wt = join(r.dir, "..", "wt");
    r.git("worktree", "add", "-q", wt);

    await install({ cwd: wt });

    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("auto-wired pre-commit works when installed from a sub-package", async () => {
    const r = createRepo({
      "fmt.js": FMT,
      "packages/app/a.js": "one\n",
      "packages/app/.nano-staged.json": JSON.stringify({ "*.js": "node fmt.js" }),
    });
    cleanups.push(r.cleanup);
    await install({ cwd: join(r.dir, "packages/app") });
    r.write("packages/app/a.js", "uno\n");
    r.git("add", "-A");

    commit(r);

    expect(r.git("show", "HEAD:packages/app/a.js")).toBe("UNO\n");
  });

  it("fails loudly on a malformed staged config and keeps the installed hook", async () => {
    const r = repo();
    writeFileSync(join(r.dir, ".nano-staged.json"), JSON.stringify({ "*.js": "echo" }));
    await install({ cwd: r.dir });
    writeFileSync(join(r.dir, ".nano-staged.json"), "{ not json");

    await expect(install({ cwd: r.dir })).rejects.toThrow(/\.nano-staged\.json/);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("rejects outside a git repository", async () => {
    const t = createTempDir();
    cleanups.push(t.cleanup);

    await expect(install({ cwd: t.dir })).rejects.toThrow(/not a git repository/);
  });

  it("works when the project path contains spaces and a quote", async () => {
    // Double quotes are not allowed in Windows paths.
    const dirName = process.platform === "win32" ? "my proj it's" : `my "proj" it's`;
    const r = repo({ "pre-commit": "touch ran" }, { dirName });
    await install({ cwd: r.dir });

    commit(r);

    expect(existsSync(join(r.dir, "ran"))).toBe(true);
  });
});

describe("uninstall", () => {
  it("removes only managed hooks and keeps unmanaged ones", async () => {
    const r = repo({ "pre-commit": "echo a" });
    await install({ cwd: r.dir });
    writeFileSync(hookPath(r, "pre-push"), "#!/bin/sh\necho mine\n");

    const result = await uninstall({ cwd: r.dir });

    expect(result.removed).toEqual(["pre-commit"]);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(false);
    expect(existsSync(hookPath(r, "pre-push"))).toBe(true);
  });
});
