import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { install } from "../src/commands/install.js";
import { uninstall } from "../src/commands/uninstall.js";
import { FMT, createRepo, createTempDir, linkCli } from "./helpers.js";

const cleanups = [];
/** Repo whose nano-hooks config has the given hooks, plus any extra sections. */
function repo(hooks = {}, options, extra = {}) {
  const r = createRepo({ ".nano-hooks.json": JSON.stringify({ hooks, ...extra }) }, options);
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

    expect(result.installed.toSorted()).toEqual(["commit-msg", "pre-commit"]);
    const script = readFileSync(hookPath(r, "pre-commit"), "utf8");
    expect(script.startsWith("#!/bin/sh\n# nano-hooks: managed file")).toBe(true);
    expect(script).toContain("echo hello");
  });

  // Windows has no executable bit; git for Windows runs the script through sh anyway.
  it.skipIf(process.platform === "win32")("makes managed scripts executable", async () => {
    const r = repo({ "pre-commit": "echo hello" });

    await install({ cwd: r.dir });

    expect(statSync(hookPath(r, "pre-commit")).mode & 0o111).toBe(0o111);
  });

  it("auto-wires pre-commit to the staged runner when a staged config exists", async () => {
    const r = repo({}, undefined, { staged: { "*.js": "echo" } });

    await install({ cwd: r.dir });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain("\nnano-hooks staged\n");
  });

  it("writes no absolute paths into the scripts", async () => {
    const r = createRepo({
      "packages/app/.nano-hooks.json": JSON.stringify({
        hooks: { "pre-push": "echo push" },
        staged: { "*.js": "echo" },
      }),
    });
    cleanups.push(r.cleanup);

    await install({ cwd: join(r.dir, "packages/app"), config: ".nano-hooks.json" });

    for (const name of ["pre-commit", "pre-push"]) {
      const script = readFileSync(hookPath(r, name), "utf8");
      expect(script).not.toContain(r.dir);
      expect(script).toContain(`PATH="$PWD"/'packages/app/node_modules/.bin':"$PATH"`);
    }
    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain(
      "cd 'packages/app' && nano-hooks staged --config '.nano-hooks.json'",
    );
  });

  it("installs from an explicit config and bakes it into the auto-wired pre-commit", async () => {
    const r = createRepo({
      "fmt.js": FMT,
      "a.js": "one\n",
      "tools/hooks.json": JSON.stringify({
        hooks: { "pre-push": "echo push" },
        staged: { "*.js": "node fmt.js" },
      }),
    });
    cleanups.push(r.cleanup);

    const result = await install({ cwd: r.dir, config: "tools/hooks.json" });

    expect(result.installed.toSorted()).toEqual(["pre-commit", "pre-push"]);
    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain(
      "nano-hooks staged --config 'tools/hooks.json'",
    );
    r.write("a.js", "uno\n");
    r.git("add", "a.js");
    commit(r);
    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
  });

  it("does not auto-wire when pre-commit is configured", async () => {
    const r = repo({ "pre-commit": "echo mine" }, undefined, { staged: { "*.js": "echo" } });

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

  it("runs a list of commands one after the other", async () => {
    const r = repo({ "pre-commit": ["echo 1 >> order", "echo 2 >> order; echo 3 >> order"] });
    await install({ cwd: r.dir });

    commit(r);

    expect(r.read("order").split(/\s+/).filter(Boolean)).toEqual(["1", "2", "3"]);
  });

  it("stops a list at the first failing command and fails the hook", async () => {
    const r = repo({ "pre-commit": ["echo 1 >> order", "exit 3", "echo 2 >> order"] });
    await install({ cwd: r.dir });

    expect(() => commit(r)).toThrow(/Command failed/);
    expect(r.read("order").trim()).toBe("1");
  });

  it("stops a list when a command with || fails in its last part", async () => {
    const r = repo({ "pre-commit": ["false || false", "touch ran"] });
    await install({ cwd: r.dir });

    expect(() => commit(r)).toThrow(/Command failed/);
    expect(existsSync(join(r.dir, "ran"))).toBe(false);
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
    writeFileSync(
      join(r.dir, ".nano-hooks.json"),
      JSON.stringify({ hooks: { "pre-commit": "echo a" } }),
    );

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
      JSON.stringify({ hooks: { "pre-commit": "echo a" }, preserveUnused: true }),
    );

    await install({ cwd: r.dir });

    expect(existsSync(hookPath(r, "commit-msg"))).toBe(true);
  });

  it("preserveUnused: [name] keeps only that hook", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b", "pre-push": "echo c" });
    await install({ cwd: r.dir });
    writeFileSync(
      join(r.dir, ".nano-hooks.json"),
      JSON.stringify({ hooks: { "pre-commit": "echo a" }, preserveUnused: ["commit-msg"] }),
    );

    await install({ cwd: r.dir });

    expect(existsSync(hookPath(r, "commit-msg"))).toBe(true);
    expect(existsSync(hookPath(r, "pre-push"))).toBe(false);
  });

  it("options.preserveUnused keeps hooks and wins over the top-level key", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b", "pre-push": "echo c" });
    await install({ cwd: r.dir });
    writeFileSync(
      join(r.dir, ".nano-hooks.json"),
      JSON.stringify({
        hooks: { "pre-commit": "echo a" },
        preserveUnused: true,
        options: { preserveUnused: ["commit-msg"] },
      }),
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

  it("reports a hooks dir outside .git only when core.hooksPath points there", async () => {
    const r = repo({ "pre-commit": "echo a" });
    expect(await install({ cwd: r.dir })).toMatchObject({ external: false });

    r.git("config", "core.hooksPath", ".husky/_");
    const result = await install({ cwd: r.dir });

    expect(result).toMatchObject({ external: true, hooksDir: join(r.dir, ".husky/_") });
  });

  it("does not report a hooks dir inside .git, or from a linked worktree", async () => {
    const r = repo({ "pre-commit": "echo a" });
    const wt = join(r.dir, "..", "wt");
    r.git("worktree", "add", "-q", wt);

    expect(await install({ cwd: wt })).toMatchObject({ external: false });
    r.git("config", "core.hooksPath", ".git/custom-hooks");
    expect(await install({ cwd: r.dir })).toMatchObject({ external: false });
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
      "packages/app/.nano-hooks.json": JSON.stringify({ staged: { "*.js": "node fmt.js" } }),
    });
    cleanups.push(r.cleanup);
    linkCli(join(r.dir, "packages/app"));
    await install({ cwd: join(r.dir, "packages/app") });
    r.write("packages/app/a.js", "uno\n");
    r.git("add", "-A");

    commit(r);

    expect(r.git("show", "HEAD:packages/app/a.js")).toBe("UNO\n");
  });

  it("fails loudly on a malformed config and keeps the installed hook", async () => {
    const r = repo({}, undefined, { staged: { "*.js": "echo" } });
    await install({ cwd: r.dir });
    writeFileSync(join(r.dir, ".nano-hooks.json"), "{ not json");

    await expect(install({ cwd: r.dir })).rejects.toThrow(/\.nano-hooks\.json/);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("rejects outside a git repository", async () => {
    const t = createTempDir();
    cleanups.push(t.cleanup);

    await expect(install({ cwd: t.dir })).rejects.toThrow(/Not a git repository/);
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
