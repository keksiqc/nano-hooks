import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FAIL, FMT, RESET, nano, nanoWith, testRepo } from "./helpers.js";

const repo = (files) => testRepo({ "fmt.js": FMT, "fail.js": FAIL, "reset.js": RESET, ...files });
const stage = (r, path, content) => {
  r.write(path, content);
  r.git("add", path);
};
const fmtMap = { "*.js": "node fmt.js" };
const hooks = (map) => JSON.stringify({ hooks: map });
const stagedConfig = JSON.stringify({ staged: fmtMap });

const order = (options, ...args) => {
  const r = repo({
    "a.js": "one\n",
    "slow.js": `setTimeout(() => require("node:fs").appendFileSync("order", "1"), 400);\n`,
    "fast.js": `require("node:fs").appendFileSync("order", "2");\n`,
    ".nano-hooks.json": JSON.stringify({
      staged: { "*.js": "node slow.js", "a.*": "node fast.js" },
      options,
    }),
  });
  stage(r, "a.js", "uno\n");
  expect(nano(r, "staged", ...args).status).toBe(0);
  return r.read("order");
};

const secondPatternRuns = (...args) => {
  const r = repo({
    "a.js": "one\n",
    "mark.js": `require("node:fs").writeFileSync("marker", "1");\n`,
    ".nano-hooks.json": JSON.stringify({
      staged: { "*.js": "node fail.js", "a.*": "node mark.js" },
    }),
  });
  stage(r, "a.js", "uno\n");
  expect(nano(r, "staged", "--no-parallel", ...args).status).toBe(1);
  return existsSync(join(r.dir, "marker"));
};

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

    expect(result.stderr).not.toContain("\x1B[?25");
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
    expect(result.stderr).toMatch(/No staged tasks configured/u);
  });

  it("exits 1 and lists the problems when the config is invalid", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": hooks({ "pre-comit": "x" }) });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Invalid nano-hooks configuration in .nano-hooks.json:");
    expect(result.stderr).toContain('hooks.pre-comit: unknown git hook "pre-comit"');
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

  it("options.allowEmpty in the configuration lets an emptied commit through", () => {
    const r = repo({
      "a.js": "x\n",
      ".nano-hooks.json": JSON.stringify({
        staged: { "*.js": "node reset.js" },
        options: { allowEmpty: true },
      }),
    });
    stage(r, "a.js", "y\n");

    expect(nano(r, "staged").status).toBe(0);
  });

  describe("parallel patterns", () => {
    it("run side by side by default", () => {
      expect(order({})).toBe("21");
    });

    it("run one after the other with options.parallel: false", () => {
      expect(order({ parallel: false })).toBe("12");
    });

    it("run one after the other with --no-parallel", () => {
      expect(order({}, "--no-parallel")).toBe("12");
    });

    it("--no-parallel wins over options.parallel: true", () => {
      expect(order({ parallel: true }, "--no-parallel")).toBe("12");
    });
  });

  describe("--bail", () => {
    it("runs the other patterns after a failure without it", () => {
      expect(secondPatternRuns()).toBe(true);
    });

    it("stops the other patterns after a failure", () => {
      expect(secondPatternRuns("--bail")).toBe(false);
    });
  });
});

describe("staged values in options", () => {
  it("restage: false in options leaves the changes of the commands out of the commit", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({ staged: fmtMap, options: { restage: false } }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("uno\n");
    expect(r.read("a.js")).toBe("UNO\n");
  });

  it("--no-restage wins over options.restage", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({ staged: fmtMap, options: { restage: true } }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--no-restage").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("uno\n");
  });

  it("staged fails clearly when the configuration has no staged key", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo a" }) });

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'No staged tasks configured. Add a "staged" key to your nano-hooks configuration.',
    );
  });
});

const calls = (...rest) => ["nano-hooks staged", ...rest];
const commands = (hook, staged = fmtMap) =>
  JSON.stringify({ hooks: { "pre-commit": hook }, staged });

describe("nano-hooks run with a hook that calls staged", () => {
  it("runs the staged step before the commands that follow", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands(calls("cp a.js seen")) });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(0);
    expect(r.read("seen")).toBe("UNO\n");
  });

  it("does not run the commands that follow when the staged step fails", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": commands(calls("touch ran"), { "*.js": "node fail.js" }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(1);
    expect(existsSync(join(r.dir, "ran"))).toBe(false);
  });

  it("returns the exit code of the commands that follow", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands(calls("exit 5")) });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(5);
  });

  it("runs the other commands when nothing is staged", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands(calls("touch ran")) });

    expect(nano(r, "run", "pre-commit").status).toBe(0);
    expect(existsSync(join(r.dir, "ran"))).toBe(true);
  });

  it("a commit runs both through the installed hook", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands(calls("cp a.js seen")) });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
    expect(r.read("seen")).toBe("UNO\n");
  });
});

const appendScript = (name) => `require("node:fs").appendFileSync("order", "${name}");\n`;

describe("lists of commands", () => {
  it("staged runs a list in order and stops at the first failure", () => {
    const r = repo({
      "a.js": "one\n",
      "one.js": appendScript("1"),
      ".nano-hooks.json": JSON.stringify({
        staged: { "*.js": ["node one.js", "node fail.js"] },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged").status).toBe(1);
    expect(r.read("order")).toBe("1");
  });

  it("run runs a list of hook commands", () => {
    const r = repo({
      ".nano-hooks.json": hooks({
        "commit-msg": ["echo first >> order", "echo second >> order"],
      }),
    });

    expect(nano(r, "run", "commit-msg").status).toBe(0);
    expect(r.read("order")).toBe("first\nsecond\n");
  });

  it("run returns the exit code of the first failing command", () => {
    const r = repo({
      ".nano-hooks.json": hooks({ "pre-push": ["exit 4", "touch ran"] }),
    });

    expect(nano(r, "run", "pre-push").status).toBe(4);
    expect(existsSync(join(r.dir, "ran"))).toBe(false);
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

  it("rejects an extra argument after the hook name", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "commit-msg": "echo hi" }) });

    const result = nano(r, "run", "commit-msg", "MSG_FILE");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Unused args: `MSG_FILE`");
  });

  it("exits with the exit code of the command", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-push": "exit 3" }) });

    expect(nano(r, "run", "pre-push").status).toBe(3);
  });

  it("runs without the hook being installed and ignores the hook skip variables", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-push": "echo ran" }) });

    const result = nanoWith(
      r,
      { env: { SKIP_NANO_HOOKS: "1", NANO_HOOKS: "0" } },
      "run",
      "pre-push",
    );

    expect(result.stdout).toBe("ran\n");
  });

  it("--config before the hook name picks the config file", () => {
    const r = repo({ "custom.json": hooks({ "pre-push": "echo custom" }) });

    expect(nano(r, "run", "--config", "custom.json", "pre-push").stdout).toBe("custom\n");
  });

  it("needs a hook name", () => {
    const result = nano(repo(), "run");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× missing required args for command `run <hook>`");
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
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo a" }) });
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
    r.write(".husky/_/h", "# written by another tool\n");

    const result = nano(r);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("core.hooksPath points outside .git");
    expect(result.stderr).toContain("git config --unset core.hooksPath");
    expect(result.stderr).toContain("√ Installed pre-commit");
  });

  it("install only says where the hooks go when only nano-hooks writes to core.hooksPath", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo hi" }) });
    r.git("config", "core.hooksPath", ".githooks-outside");

    expect(nano(r).stderr).toBe(
      "- core.hooksPath is set: hooks go to .githooks-outside instead of .git/hooks.\n√ Installed pre-commit\n",
    );
  });

  it("install reports an invalid config in the same style", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-comit": "x" }) });

    const result = nano(r, "install");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^× Invalid nano-hooks configuration in \.nano-hooks\.json:\n/u);
    expect(result.stderr).toContain('hooks.pre-comit: unknown git hook "pre-comit"');
  });

  it("says so when there is nothing to install or uninstall", () => {
    const r = repo();

    expect(nano(r, "install").stderr).toBe("- No hooks to install.\n");
    expect(nano(r, "uninstall").stderr).toBe("- No nano-hooks hooks found.\n");
  });

  it("reports removed and skipped hooks in the same style", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo a" }) });
    nano(r, "install");
    r.write(".nano-hooks.json", hooks({ "pre-push": "echo b" }));
    r.write(".git/hooks/pre-push", "#!/bin/sh\necho mine\n");

    const result = nano(r, "install");

    expect(result.stderr).toBe(
      "√ Removed pre-commit (no longer configured)\n" +
        "↓ Skipped pre-push because nano-hooks did not write the existing hook\n",
    );
  });

  it("install warns and exits 0 outside a git repository", () => {
    const r = repo();
    const result = nanoWith(r, { cwd: join(r.dir, "..") }, "install");

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/^↓ Not a git repository: .+\. Hooks were not installed\.\n$/u);
  });

  it("install does nothing when NANO_HOOKS=0", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo a" }) });

    const result = nanoWith(r, { env: { NANO_HOOKS: "0" } }, "install");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("- Skipped install because NANO_HOOKS=0.\n");
    expect(existsSync(join(r.dir, ".git/hooks/pre-commit"))).toBe(false);
  });

  it("install still reports an invalid config outside the skip case", () => {
    const r = repo({ ".nano-hooks.json": "{ not json" });

    expect(nano(r, "install").status).toBe(1);
  });
});

describe("nano-hooks --config", () => {
  const custom = hooks({ "pre-push": "echo a" });

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
    expect(result.stderr).toContain("× option `-c, --config <path>` value is missing");
  });

  it("rejects staged-only options on other commands", () => {
    const result = nano(repo(), "install", "--bail");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Unknown option `--bail`");
  });
});

describe("nano-hooks usage", () => {
  it("rejects an unknown command", () => {
    const result = nano(repo(), "frobnicate");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Unused args: `frobnicate`");
  });

  it("unknown staged option exits 1 with an error line", () => {
    const result = nano(repo(), "staged", "--nope");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Unknown option `--nope`");
  });

  it.each([[["--version"]], [["-v"]], [["uninstall", "--version"]]])(
    "%j prints the package version and exits",
    (args) => {
      const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

      const result = nano(repo(), ...args);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`nano-hooks/${version} `);
      expect(result.stderr).toBe("");
    },
  );

  it("--help lists the commands and global options", () => {
    const result = nano(repo(), "--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^nano-hooks\/\S+\n/u);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("(default: install)");
    for (const label of [
      "install",
      "uninstall",
      "staged",
      "run <hook>",
      "--config",
      "--help",
      "--version",
    ]) {
      expect(result.stdout).toContain(label);
    }
  });

  it("staged --help lists the staged options", () => {
    const result = nano(repo(), "staged", "--help");

    expect(result.status).toBe(0);
    for (const flag of ["--allow-empty", "--bail", "--no-parallel", "--no-restage"]) {
      expect(result.stdout).toContain(flag);
    }
  });
});

describe("end to end", () => {
  it("a commit runs the staged runner through the installed hook", () => {
    const r = repo({
      "a.js": "one\n",
      "package.json": JSON.stringify({
        "nano-hooks": { hooks: { "pre-commit": "nano-hooks staged" }, staged: fmtMap },
      }),
    });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
  });
});
