import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { install } from "../src/commands/install.js";
import { runHook } from "../src/commands/run.js";
import { uninstall } from "../src/commands/uninstall.js";
import { FMT, linkCli, testRepo, testTempDir } from "./helpers.js";

/** Repo whose nano-hooks config has the given hooks, plus any extra keys. */
const repo = (hooks = {}, options, extra = {}) =>
  testRepo({ ".nano-hooks.json": JSON.stringify({ ...hooks, ...extra }) }, options);

/** Replace the configuration of a repo made by `repo`. */
const configure = (r, config) => r.write(".nano-hooks.json", JSON.stringify(config));

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

  it("calls the staged command for a pre-commit hook that has staged", async () => {
    const r = repo({ "pre-commit": { staged: { "*.js": "echo" } } });

    await install({ cwd: r.dir });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain("\nnano-hooks staged\n");
  });

  it("writes no absolute paths into the scripts", async () => {
    const r = testRepo({
      "packages/app/.nano-hooks.json": JSON.stringify({
        "pre-push": "echo push",
        "pre-commit": { staged: { "*.js": "echo" } },
      }),
    });

    await install({ cwd: join(r.dir, "packages/app"), config: ".nano-hooks.json" });

    for (const name of ["pre-commit", "pre-push"]) {
      const script = readFileSync(hookPath(r, name), "utf8");
      expect(script).not.toContain(r.dir);
      expect(script).toContain(`PATH="$PWD"/'packages/app/node_modules/.bin':"$PATH"`);
    }
    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain(
      "(cd 'packages/app' && nano-hooks staged --config '.nano-hooks.json')",
    );
  });

  it("installs from an explicit config and bakes it into the staged call", async () => {
    const r = testRepo({
      "fmt.js": FMT,
      "a.js": "one\n",
      "tools/hooks.json": JSON.stringify({
        "pre-push": "echo push",
        "pre-commit": { staged: { "*.js": "node fmt.js" } },
      }),
    });

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
    configure(r, { "pre-commit": "echo a" });

    const result = await install({ cwd: r.dir });

    expect(result.removed).toEqual(["commit-msg"]);
    expect(existsSync(hookPath(r, "commit-msg"))).toBe(false);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("options.preserveUnused: true keeps unconfigured managed hooks", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b" });
    await install({ cwd: r.dir });
    configure(r, { "pre-commit": "echo a", options: { preserveUnused: true } });

    await install({ cwd: r.dir });

    expect(existsSync(hookPath(r, "commit-msg"))).toBe(true);
  });

  it("options.preserveUnused: [name] keeps only that hook", async () => {
    const r = repo({ "pre-commit": "echo a", "commit-msg": "echo b", "pre-push": "echo c" });
    await install({ cwd: r.dir });
    configure(r, { "pre-commit": "echo a", options: { preserveUnused: ["commit-msg"] } });

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

  it("the pre-commit runner works when installed from a sub-package", async () => {
    const r = testRepo({
      "fmt.js": FMT,
      "packages/app/a.js": "one\n",
      "packages/app/.nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: { "*.js": "node fmt.js" } },
      }),
    });
    linkCli(join(r.dir, "packages/app"));
    await install({ cwd: join(r.dir, "packages/app") });
    r.write("packages/app/a.js", "uno\n");
    r.git("add", "-A");

    commit(r);

    expect(r.git("show", "HEAD:packages/app/a.js")).toBe("UNO\n");
  });

  it("fails loudly on a malformed config and keeps the installed hook", async () => {
    const r = repo({ "pre-commit": { staged: { "*.js": "echo" } } });
    await install({ cwd: r.dir });
    writeFileSync(join(r.dir, ".nano-hooks.json"), "{ not json");

    await expect(install({ cwd: r.dir })).rejects.toThrow(/\.nano-hooks\.json/);
    expect(existsSync(hookPath(r, "pre-commit"))).toBe(true);
  });

  it("rejects outside a git repository", async () => {
    const t = testTempDir();

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

describe("pre-commit with staged", () => {
  it("calls staged, with a quoted config file and the directory prefix when needed", async () => {
    const r = testRepo({
      "it's dir/c.json": JSON.stringify({ "pre-commit": { staged: { "*.js": "echo" } } }),
    });
    await install({ cwd: join(r.dir, "it's dir"), config: "c.json" });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain(
      `\n(cd 'it'\\''s dir' && nano-hooks staged --config 'c.json')\n`,
    );
  });

  it("writes the staged call first and then the run commands as they are", async () => {
    const r = repo({ "pre-commit": { staged: { "*.js": "echo" }, run: ["echo a", "echo b $1"] } });

    await install({ cwd: r.dir });

    expect(readFileSync(hookPath(r, "pre-commit"), "utf8")).toContain(
      "{ nano-hooks staged\n} || exit $?\n{ echo a\n} || exit $?\necho b $1\n",
    );
  });

  it("starts the run commands in the repository root, also from a sub-package", async () => {
    const r = testRepo({
      "fmt.js": FMT,
      "packages/app/a.js": "one\n",
      "packages/app/.nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: { "*.js": "node fmt.js" }, run: "pwd > where" },
      }),
    });
    linkCli(join(r.dir, "packages/app"));
    await install({ cwd: join(r.dir, "packages/app") });
    r.write("packages/app/a.js", "uno\n");
    r.git("add", "-A");

    commit(r);

    expect(r.git("show", "HEAD:packages/app/a.js")).toBe("UNO\n");
    expect(existsSync(join(r.dir, "where"))).toBe(true);
    expect(existsSync(join(r.dir, "packages/app/where"))).toBe(false);
  });

  it("writes the commands of a hook without staged as they are", async () => {
    const r = repo({ "pre-commit": { run: ["echo a", "echo b"] } });

    await install({ cwd: r.dir });

    const script = readFileSync(hookPath(r, "pre-commit"), "utf8");
    expect(script).toContain("{ echo a\n} || exit $?\necho b");
    expect(script).not.toContain("nano-hooks run");
  });

  // An installed hook and an immediate run do the same.
  const runners = {
    "an installed hook": async (r, config) => {
      await install({ cwd: r.dir, config });
      commit(r);
    },
    "an immediate run": async (r, config) => {
      expect(await runHook("pre-commit", [], { cwd: r.dir, config })).toBe(0);
    },
  };
  // Double quotes are not allowed in Windows paths.
  const dirName = process.platform === "win32" ? "my proj it's" : `my "proj" it's`;
  const configFile = "it's config.json";

  /** A repo with `a.js` staged and a config file with an awkward name and path. */
  function stagedRepo(config) {
    const r = testRepo(
      { "fmt.js": FMT, "a.js": "one\n", [configFile]: JSON.stringify(config) },
      { dirName },
    );
    r.write("a.js", "uno\n");
    r.git("add", "a.js");
    return r;
  }

  it.each(Object.entries(runners))(
    "runs the staged step with a custom config through %s",
    async (_, runner) => {
      const r = stagedRepo({ "pre-commit": { staged: { "*.js": "node fmt.js" } } });

      await runner(r, configFile);

      expect(r.git("show", ":a.js")).toBe("UNO\n");
    },
  );

  it.each(Object.entries(runners))(
    "runs the staged step first and then the run commands through %s",
    async (_, runner) => {
      const r = stagedRepo({
        "pre-commit": {
          staged: { "*.js": "node fmt.js" },
          run: "cp a.js seen",
        },
      });

      await runner(r, configFile);

      expect(r.git("show", ":a.js")).toBe("UNO\n");
      expect(r.read("seen")).toBe("UNO\n");
    },
  );
});
