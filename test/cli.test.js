import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FAIL, FMT, RESET, createRepo } from "./helpers.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const repos = [];
function repo(files) {
  const r = createRepo({ "fmt.js": FMT, "fail.js": FAIL, "reset.js": RESET, ...files });
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

const nano = (r, ...args) => spawnSync("node", [CLI, ...args], { cwd: r.dir, encoding: "utf8" });
const stage = (r, path, content) => {
  r.write(path, content);
  r.git("add", path);
};
const fmtMap = { "*.js": "node fmt.js" };
const hooks = (map) => JSON.stringify({ hooks: map });
const stagedConfig = JSON.stringify({ staged: fmtMap });

describe("nano-hooks staged", () => {
  it("formats staged files and exits 0", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": stagedConfig });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("prints no cursor control sequences when stderr is not a TTY", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": stagedConfig });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.stderr).not.toContain("\x1b[?25");
  });

  it("exits 1 when a command fails", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({ staged: { "*.js": "node fail.js" } }),
    });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("node fail.js");
    expect(r.git("show", ":a.js")).toBe("uno\n");
    expect(r.read("a.js")).toBe("uno\n");
  });

  it("exits 1 without a config", () => {
    const r = repo({ "a.js": "one\n" });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/No staged tasks configured/);
  });

  it("exits 1 and lists the problems when the config is invalid", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": JSON.stringify({ "pre-commit": "x" }) });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Invalid nano-hooks configuration in .nano-hooks.json:");
    expect(result.stderr).toContain("pre-commit");
  });

  it("--config points at a specific nano-hooks config file", () => {
    const r = repo({ "a.js": "one\n", "custom.json": stagedConfig });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--config", "custom.json").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("--allow-empty lets an emptied commit through", () => {
    const r = repo({
      "a.js": "x\n",
      ".nano-hooks.json": JSON.stringify({ staged: { "*.js": "node reset.js" } }),
    });
    stage(r, "a.js", "y\n");

    expect(nano(r, "staged").status).toBe(1);
    expect(nano(r, "staged", "--allow-empty").status).toBe(0);
  });

  it("--bail is accepted", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": stagedConfig });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--bail").status).toBe(0);
  });
});

describe("nano-hooks run", () => {
  it("runs the command of the named hook", () => {
    const r = repo({
      ".nano-hooks.json": hooks({ "pre-push": "echo pushed", "pre-commit": "false" }),
    });

    const result = nano(r, "run", "pre-push");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("pushed\n");
  });

  it("passes the arguments after the hook name to the command", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "commit-msg": 'echo "$1" "$2"' }) });

    const result = nano(r, "run", "commit-msg", "MSG_FILE", "--flag");

    expect(result.stdout).toBe("MSG_FILE --flag\n");
  });

  it("exits with the exit code of the command", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-push": "exit 3" }) });

    expect(nano(r, "run", "pre-push").status).toBe(3);
  });

  it("runs without the hook being installed and ignores SKIP_NANO_HOOKS", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-push": "echo ran" }) });

    const result = spawnSync("node", [CLI, "run", "pre-push"], {
      cwd: r.dir,
      encoding: "utf8",
      env: { ...process.env, SKIP_NANO_HOOKS: "1" },
    });

    expect(result.stdout).toBe("ran\n");
  });

  it("--config before the hook name picks the config file", () => {
    const r = repo({ "custom.json": hooks({ "pre-push": "echo custom" }) });

    expect(nano(r, "run", "--config", "custom.json", "pre-push").stdout).toBe("custom\n");
  });

  it("runs the staged runner for pre-commit when only staged is set", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": stagedConfig });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("needs a hook name", () => {
    const result = nano(repo(), "run");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('× Command "run" needs a hook name.\n');
  });

  it("rejects an unknown hook", () => {
    const result = nano(repo(), "run", "pre-comit");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('× Unknown git hook "pre-comit". Valid hooks: ');
  });

  it("rejects a hook with no configured command", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-push": "echo a" }) });

    const result = nano(r, "run", "pre-commit");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('× No command configured for hook "pre-commit".\n');
  });
});

describe("nano-hooks install / uninstall", () => {
  it("install writes hooks and uninstall removes them", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ hooks: { "pre-commit": "echo a" } }) });
    const hook = join(r.dir, ".git/hooks/pre-commit");

    const installed = nano(r);
    expect(installed.status).toBe(0);
    expect(installed.stderr).toBe("√ Installed pre-commit\n");
    expect(installed.stdout).toBe("");
    expect(existsSync(hook)).toBe(true);

    const removed = nano(r, "uninstall");
    expect(removed.status).toBe(0);
    expect(removed.stderr).toBe("√ Removed pre-commit\n");
    expect(existsSync(hook)).toBe(false);
  });

  it("install warns when core.hooksPath points outside .git", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo hi" }) });
    expect(nano(r).stderr).toBe("√ Installed pre-commit\n");
    r.git("config", "core.hooksPath", ".husky/_");

    const result = nano(r);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("core.hooksPath points outside .git");
    expect(result.stderr).toContain("√ Installed pre-commit");
  });

  it("install reports an invalid config in the same style", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ hooks: { "pre-comit": "x" } }) });

    const result = nano(r, "install");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^× Invalid nano-hooks configuration in \.nano-hooks\.json:\n/);
    expect(result.stderr).toContain("hooks.pre-comit: unknown git hook");
  });

  it("says so when there is nothing to install or uninstall", () => {
    const r = repo();

    expect(nano(r, "install").stderr).toBe("- No hooks to install.\n");
    expect(nano(r, "uninstall").stderr).toBe("- No nano-hooks hooks found.\n");
  });

  it("reports removed and skipped hooks in the same style", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ hooks: { "pre-commit": "echo a" } }) });
    nano(r, "install");
    r.write(".nano-hooks.json", JSON.stringify({ hooks: { "pre-push": "echo b" } }));
    r.write(".git/hooks/pre-push", "#!/bin/sh\necho mine\n");

    const result = nano(r, "install");

    expect(result.stderr).toBe(
      "√ Removed pre-commit (no longer configured)\n" +
        "↓ Skipped pre-push because nano-hooks did not write the existing hook\n",
    );
  });

  it("install reports an error outside a git repository", () => {
    const r = repo();
    const result = spawnSync("node", [CLI, "install"], {
      cwd: join(r.dir, ".."),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^× Not a git repository: /);
  });
});

describe("nano-hooks --config", () => {
  const custom = JSON.stringify({ hooks: { "pre-push": "echo a" } });

  it("install -c reads hooks from that file", () => {
    const r = repo({ "custom.json": custom });

    const result = nano(r, "install", "-c", "custom.json");

    expect(result.stderr).toBe("√ Installed pre-push\n");
    expect(existsSync(join(r.dir, ".git/hooks/pre-push"))).toBe(true);
  });

  it("works before the command too", () => {
    const r = repo({ "custom.json": custom });

    expect(nano(r, "--config", "custom.json", "install").stderr).toBe("√ Installed pre-push\n");
  });

  it("uninstall accepts it", () => {
    const r = repo({ "custom.json": custom });
    nano(r, "install", "--config", "custom.json");

    expect(nano(r, "uninstall", "--config", "custom.json").stderr).toBe("√ Removed pre-push\n");
  });

  it("reports a missing config file", () => {
    const result = nano(repo(), "install", "--config", "nope.json");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("× Configuration file nope.json not found.\n");
  });

  it("needs a path", () => {
    const result = nano(repo(), "install", "--config");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('× Option "--config" needs a path.\n');
  });

  it("rejects staged-only options on other commands", () => {
    const result = nano(repo(), "install", "--bail");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('× Option "--bail" only applies to "staged".\n');
  });
});

describe("nano-hooks usage", () => {
  it("unknown command exits 1 and prints usage", () => {
    const result = nano(repo(), "frobnicate");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('× Unknown command "frobnicate".');
    expect(result.stderr).toContain("Usage: nano-hooks");
  });

  it("unknown staged option exits 1 with an error line", () => {
    const result = nano(repo(), "staged", "--nope");

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('× Unknown option "--nope".\n');
  });

  it("--help exits 0", () => {
    const result = nano(repo(), "--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: nano-hooks");
  });
});

describe("end to end", () => {
  it("a commit runs the staged runner through the installed hook", () => {
    const r = repo({
      "a.js": "one\n",
      "package.json": JSON.stringify({ "nano-hooks": { staged: fmtMap } }),
    });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
  });
});
