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
const hooks = (map) => JSON.stringify(map);
const stagedConfig = JSON.stringify({ "pre-commit": { staged: fmtMap } });

// Both patterns match a.js. The first command is slow, so it ends last when they overlap.
const order = (options, ...args) => {
  const r = repo({
    "a.js": "one\n",
    "slow.js": `setTimeout(() => require("node:fs").appendFileSync("order", "1"), 400);\n`,
    "fast.js": `require("node:fs").appendFileSync("order", "2");\n`,
    ".nano-hooks.json": JSON.stringify({
      "pre-commit": { staged: { "*.js": "node slow.js", "a.*": "node fast.js" } },
      options,
    }),
  });
  stage(r, "a.js", "uno\n");
  expect(nano(r, "staged", ...args).status).toBe(0);
  return r.read("order");
};

// The first pattern fails. The second one runs only if the failure did not stop the rest.
/** Whether the second pattern ran after the first one failed, for the given staged options. */
const secondPatternRuns = (...args) => {
  const r = repo({
    "a.js": "one\n",
    "mark.js": `require("node:fs").writeFileSync("marker", "1");\n`,
    ".nano-hooks.json": JSON.stringify({
      "pre-commit": { staged: { "*.js": "node fail.js", "a.*": "node mark.js" } },
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

    expect(result.stderr).not.toContain("\x1b[?25");
  });

  it("exits 1 when a command fails", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({ "pre-commit": { staged: { "*.js": "node fail.js" } } }),
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
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": JSON.stringify({ "pre-comit": "x" }) });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("× Invalid nano-hooks configuration in .nano-hooks.json:");
    expect(result.stderr).toContain("pre-comit: unknown key");
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
      ".nano-hooks.json": JSON.stringify({ "pre-commit": { staged: { "*.js": "node reset.js" } } }),
    });
    stage(r, "a.js", "y\n");

    expect(nano(r, "staged").status).toBe(1);
    expect(nano(r, "staged", "--allow-empty").status).toBe(0);
  });

  it("options.allowEmpty in the configuration lets an emptied commit through", () => {
    const r = repo({
      "a.js": "x\n",
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: { "*.js": "node reset.js" } },
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

const stagedFiles = { "*.js": "node reset.js" };
const emptied = (config, ...args) => {
  const r = repo({ "a.js": "x\n", ".nano-hooks.json": JSON.stringify(config) });
  stage(r, "a.js", "y\n");
  return nano(r, "staged", ...args).status;
};

describe("settings of the pre-commit hook", () => {
  it("allowEmpty in the hook lets an emptied commit through", () => {
    expect(emptied({ "pre-commit": { staged: stagedFiles } })).toBe(1);
    expect(emptied({ "pre-commit": { staged: stagedFiles, allowEmpty: true } })).toBe(0);
  });

  it("a setting in the hook wins over options", () => {
    const hook = { staged: stagedFiles, allowEmpty: false };

    expect(emptied({ options: { allowEmpty: true }, "pre-commit": hook })).toBe(1);
  });

  it("a command line option wins over the hook", () => {
    const config = { "pre-commit": { staged: stagedFiles, allowEmpty: false } };

    expect(emptied(config, "--allow-empty")).toBe(0);
  });

  it("parallel: false in the hook runs the patterns one after the other", () => {
    const r = repo({
      "a.js": "one\n",
      "slow.js": `setTimeout(() => require("node:fs").appendFileSync("order", "1"), 400);\n`,
      "fast.js": `require("node:fs").appendFileSync("order", "2");\n`,
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": {
          staged: { "*.js": "node slow.js", "a.*": "node fast.js" },
          parallel: false,
        },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged").status).toBe(0);
    expect(r.read("order")).toBe("12");
  });

  it("restage: false in the hook leaves the changes of the commands out of the commit", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: fmtMap, restage: false },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("uno\n");
    expect(r.read("a.js")).toBe("UNO\n");
  });

  it("--no-restage wins over options.restage", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: fmtMap },
        options: { restage: true },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--no-restage").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("uno\n");
  });

  it("staged fails clearly when the pre-commit hook has no staged key", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": "echo a" }) });

    const result = nano(r, "staged");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No staged tasks configured");
  });
});

const commands = (extra) =>
  JSON.stringify({ "pre-commit": { staged: fmtMap, run: "cp a.js seen", ...extra } });

describe("nano-hooks run with a pre-commit object", () => {
  it("runs the staged step before the run commands", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands() });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(0);
    expect(r.read("seen")).toBe("UNO\n");
  });

  it("does not run the commands when the staged step fails", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: { "*.js": "node fail.js" }, run: "touch ran" },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(1);
    expect(existsSync(join(r.dir, "ran"))).toBe(false);
  });

  it("returns the exit code of the run commands", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-hooks.json": commands({ run: "exit 5" }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "run", "pre-commit").status).toBe(5);
  });

  it("runs only the run commands when nothing is staged", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands({ run: "touch ran" }) });

    expect(nano(r, "run", "pre-commit").status).toBe(0);
    expect(existsSync(join(r.dir, "ran"))).toBe(true);
  });

  it("a commit runs both through the installed hook", () => {
    const r = repo({ "a.js": "one\n", ".nano-hooks.json": commands() });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
    expect(r.read("seen")).toBe("UNO\n");
  });
});

describe("old configuration", () => {
  it("is rejected with a hint, and install keeps the hooks that exist", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": "echo a" }) });
    expect(nano(r, "install").status).toBe(0);
    r.write(".nano-hooks.json", JSON.stringify({ hooks: { "pre-commit": "echo a" } }));

    const result = nano(r, "install");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("hooks: removed. Put each hook at the top level");
    expect(existsSync(join(r.dir, ".git/hooks/pre-commit"))).toBe(true);
  });

  it("is rejected when it is a .nano-hooks.mjs file", () => {
    const r = repo({ ".nano-hooks.mjs": "export default {};\n" });

    const result = nano(r, "install");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Found .nano-hooks.mjs. nano-hooks reads only JSON");
  });
});

/** A script that appends `name` to the file `order`. */
const appendScript = (name) => `require("node:fs").appendFileSync("order", "${name}");\n`;

describe("lists of commands", () => {
  it("staged runs a list in order and stops at the first failure", () => {
    const r = repo({
      "a.js": "one\n",
      "one.js": appendScript("1"),
      ".nano-hooks.json": JSON.stringify({
        "pre-commit": { staged: { "*.js": ["node one.js", "node fail.js"] } },
      }),
    });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged").status).toBe(1);
    expect(r.read("order")).toBe("1");
  });

  it("run runs a list of hook commands and passes the arguments to each", () => {
    const r = repo({
      ".nano-hooks.json": JSON.stringify({
        "commit-msg": ['echo "first $1" >> order', 'echo "second $1" >> order'],
      }),
    });

    expect(nano(r, "run", "commit-msg", "msg.txt").status).toBe(0);
    expect(r.read("order")).toBe("first msg.txt\nsecond msg.txt\n");
  });

  it("run returns the exit code of the first failing command", () => {
    const r = repo({
      ".nano-hooks.json": JSON.stringify({ "pre-push": ["exit 4", "touch ran"] }),
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

    const result = nanoWith(r, { env: { SKIP_NANO_HOOKS: "1" } }, "run", "pre-push");

    expect(result.stdout).toBe("ran\n");
  });

  it("--config before the hook name picks the config file", () => {
    const r = repo({ "custom.json": hooks({ "pre-push": "echo custom" }) });

    expect(nano(r, "run", "--config", "custom.json", "pre-push").stdout).toBe("custom\n");
  });

  it("runs the staged step of a pre-commit object", () => {
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
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": "echo a" }) });
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
    expect(result.stderr).toContain("√ Installed pre-commit");
  });

  it("install does not warn about core.hooksPath when only nano-hooks writes there", () => {
    const r = repo({ ".nano-hooks.json": hooks({ "pre-commit": "echo hi" }) });
    r.git("config", "core.hooksPath", ".githooks-outside");

    expect(nano(r).stderr).toBe("√ Installed pre-commit\n");
  });

  it("install reports an invalid config in the same style", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-comit": "x" }) });

    const result = nano(r, "install");

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^× Invalid nano-hooks configuration in \.nano-hooks\.json:\n/);
    expect(result.stderr).toContain("pre-comit: unknown key");
  });

  it("says so when there is nothing to install or uninstall", () => {
    const r = repo();

    expect(nano(r, "install").stderr).toBe("- No hooks to install.\n");
    expect(nano(r, "uninstall").stderr).toBe("- No nano-hooks hooks found.\n");
  });

  it("reports removed and skipped hooks in the same style", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": "echo a" }) });
    nano(r, "install");
    r.write(".nano-hooks.json", JSON.stringify({ "pre-push": "echo b" }));
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
    expect(result.stderr).toMatch(/^↓ Not a git repository: .+\. Hooks were not installed\.\n$/);
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
  const custom = JSON.stringify({ "pre-push": "echo a" });

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

  it.each(["--version", "-v"])("%s prints the package version", (flag) => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

    const result = nano(repo(), flag);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
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
      "package.json": JSON.stringify({ "nano-hooks": { "pre-commit": { staged: fmtMap } } }),
    });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
  });
});
