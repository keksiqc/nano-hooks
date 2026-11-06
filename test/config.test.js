import { describe, expect, it } from "vitest";
import { VALID_HOOKS, hookParts, loadConfig } from "../src/config.js";
import { testRepo as repo } from "./helpers.js";

const json = (value) => JSON.stringify(value);

async function problems(files) {
  const r = repo(files);
  try {
    await loadConfig(r.dir);
  } catch (error) {
    return error.message;
  }
  throw new Error("expected loadConfig to reject");
}

describe("loadConfig", () => {
  it("reads the nano-hooks key from package.json", async () => {
    const r = repo({ "package.json": json({ "nano-hooks": { "pre-commit": "echo hi" } }) });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "echo hi" },
      preserveUnused: false,
      options: {},
    });
  });

  it.each(["nano-hooks.config.json", ".nano-hooks.json"])("reads %s", async (name) => {
    const r = repo({ [name]: json({ "commit-msg": "a" }) });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it("ignores a package.json without the nano-hooks key", async () => {
    const r = repo({
      "package.json": json({ name: "x" }),
      ".nano-hooks.json": json({ "commit-msg": "a" }),
    });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it.each([
    ["package.json", "nano-hooks.config.json"],
    ["package.json", ".nano-hooks.json"],
    ["nano-hooks.config.json", ".nano-hooks.json"],
  ])("rejects a project with both %s and %s", async (first, second) => {
    const config = { "pre-commit": "x" };
    const file = (name) =>
      name === "package.json" ? json({ "nano-hooks": config }) : json(config);
    const r = repo({ [first]: file(first), [second]: file(second) });

    await expect(loadConfig(r.dir)).rejects.toThrow(
      `Found more than one nano-hooks configuration: ${first}, ${second}.`,
    );
  });

  it.each([".nano-hooks.js", ".nano-hooks.mjs"])("rejects the old file %s", async (name) => {
    const r = repo({ [name]: "export default {};\n" });

    await expect(loadConfig(r.dir)).rejects.toThrow(`Found ${name}. nano-hooks reads only JSON`);
  });

  it("rejects an old file even when a JSON configuration exists", async () => {
    const r = repo({
      ".nano-hooks.js": "export default {};\n",
      "nano-hooks.config.json": json({ "pre-commit": "x" }),
    });

    await expect(loadConfig(r.dir)).rejects.toThrow("Found .nano-hooks.js.");
  });

  it("returns empty defaults when no config exists", async () => {
    const r = repo({ "package.json": json({ name: "x" }) });

    expect(await loadConfig(r.dir)).toEqual({ hooks: {}, preserveUnused: false, options: {} });
  });

  it("keeps each hook as written", async () => {
    const r = repo({
      ".nano-hooks.json": json({
        "pre-commit": { staged: { "*.js": "eslint", "*.css": ["a", "b"] }, run: "tsc" },
        "commit-msg": "x",
        "pre-push": ["a", "b"],
      }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: {
        "pre-commit": { staged: { "*.js": "eslint", "*.css": ["a", "b"] }, run: "tsc" },
        "commit-msg": "x",
        "pre-push": ["a", "b"],
      },
      preserveUnused: false,
      options: {},
    });
  });

  it("reads the options section", async () => {
    const r = repo({
      ".nano-hooks.json": json({
        options: {
          parallel: false,
          bail: true,
          allowEmpty: true,
          restage: false,
          preserveUnused: ["pre-push"],
        },
      }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: {},
      preserveUnused: ["pre-push"],
      options: { parallel: false, bail: true, allowEmpty: true, restage: false },
    });
  });

  it("reports problems in the options section", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        options: { parallel: "no", nope: 1, preserveUnused: ["pre-comit"] },
      }),
    });

    expect(message).toContain("options.parallel: must be true or false");
    expect(message).toContain("options.nope: unknown option (expected allowEmpty, bail,");
    expect(message).toContain('options.preserveUnused[0]: unknown git hook "pre-comit"');
    expect(message).toContain("Valid hooks:");
  });

  it("rejects preserveUnused that is not a boolean or a list", async () => {
    const message = await problems({
      ".nano-hooks.json": json({ options: { preserveUnused: 1 } }),
    });

    expect(message).toContain(
      "options.preserveUnused: must be true, false or a list of hook names",
    );
  });

  it("rejects an options section that is not an object", async () => {
    const message = await problems({ ".nano-hooks.json": json({ options: true }) });

    expect(message).toContain("options: must be an object");
  });

  it("accepts a list of commands for a hook", async () => {
    const r = repo({ ".nano-hooks.json": json({ "pre-push": ["pnpm lint", "pnpm test"] }) });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "pre-push": ["pnpm lint", "pnpm test"] });
  });

  it.each([[[]], [["ok", ""]], [["ok", 5]], [""], [5]])("rejects the hook value %j", async (v) => {
    const message = await problems({ ".nano-hooks.json": json({ "pre-push": v }) });

    expect(message).toContain("pre-push: must be a command, a list of commands or an object");
  });
});

const pre = (value) => ({ ".nano-hooks.json": json({ "pre-commit": value }) });

describe("hook objects", () => {
  it("accepts run, staged and the settings of staged", async () => {
    const value = {
      run: ["npm run typecheck", "npm test"],
      staged: { "*.js": "oxlint --fix" },
      restage: true,
      parallel: false,
      bail: true,
      allowEmpty: false,
    };
    const r = repo(pre(value));

    expect((await loadConfig(r.dir)).hooks["pre-commit"]).toEqual(value);
  });

  it("accepts an object with only run, or only staged", async () => {
    await expect(loadConfig(repo(pre({ run: "x" })).dir)).resolves.toBeDefined();
    await expect(loadConfig(repo(pre({ staged: { "*": "x" } })).dir)).resolves.toBeDefined();
  });

  it("reports problems with the path of the key", async () => {
    const message = await problems(
      pre({
        run: [],
        staged: { "*.js": 5, "*.css": [] },
        parallel: "no",
        nope: 1,
      }),
    );

    expect(message).toContain("pre-commit.run: must be a command or a non-empty list of commands");
    expect(message).toContain(
      'pre-commit.staged["*.js"]: must be a command or a non-empty list of commands',
    );
    expect(message).toContain(
      'pre-commit.staged["*.css"]: must be a command or a non-empty list of commands',
    );
    expect(message).toContain("pre-commit.parallel: must be true or false");
    expect(message).toContain("pre-commit.nope: unknown key (expected run, staged, ");
  });

  it("rejects a staged glob that uses an extglob group", async () => {
    const message = await problems(pre({ staged: { "!(a).js": "fmt", "*.js": "lint" } }));

    expect(message).toContain('pre-commit.staged["!(a).js"]: "!(" groups are not supported');
    expect(message).not.toContain('staged["*.js"]');
  });

  it("rejects an empty staged key and one that is not an object", async () => {
    expect(await problems(pre({ staged: {} }))).toContain(
      "pre-commit.staged: must have at least one pattern",
    );
    expect(await problems(pre({ staged: "eslint" }))).toContain(
      "pre-commit.staged: must be an object of glob pattern to command(s)",
    );
  });

  it("rejects an object that has nothing to run", async () => {
    expect(await problems(pre({ bail: true }))).toContain('pre-commit: needs "run" or "staged"');
  });

  it("rejects the staged key and its settings on other hooks", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        "pre-push": { run: "x", staged: { "*": "y" }, bail: true },
      }),
    });

    expect(message).toContain('pre-push.staged: only the "pre-commit" hook accepts this key');
    expect(message).toContain('pre-push.bail: only the "pre-commit" hook accepts this key');
  });
});

describe("migration errors", () => {
  it("tells where each key of version 0.4 moved", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        hooks: { "pre-commit": "x" },
        staged: { "*.js": "eslint" },
        preserveUnused: true,
      }),
    });

    expect(message.split("\n")[0]).toBe("Invalid nano-hooks configuration in .nano-hooks.json:");
    expect(message).toContain(
      'hooks: removed. Put each hook at the top level, for example "pre-commit"',
    );
    expect(message).toContain('staged: moved into the "pre-commit" hook');
    expect(message).toContain("preserveUnused: moved to options.preserveUnused");
    expect(message).toContain("See MIGRATION.md.");
    expect(message).not.toContain("Valid hooks:");
  });

  it("reports every problem at once, with a list of the valid hooks for a misspelled one", async () => {
    const message = await problems({
      ".nano-hooks.json": json({ "pre-comit": "x", "commit-msg": "", foo: 1 }),
    });

    expect(message).toContain("pre-comit: unknown key (expected a git hook name or options)");
    expect(message).toContain("commit-msg: must be a command, a list of commands or an object");
    expect(message).toContain("foo: unknown key");
    expect(message).toContain(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  });

  it("rejects a configuration that is not an object", async () => {
    expect(await problems({ ".nano-hooks.json": json([]) })).toContain(
      "configuration must be an object",
    );
  });

  it("names the file when the config cannot be parsed", async () => {
    const message = await problems({ ".nano-hooks.json": "{ not json" });

    expect(message).toMatch(/^Failed to read .*\.nano-hooks\.json: /);
  });
});

describe("loadConfig with an explicit file", () => {
  it("loads it instead of discovering one, relative to cwd", async () => {
    const r = repo({
      ".nano-hooks.json": json({ "pre-commit": "discovered" }),
      "config/custom.json": json({ "pre-push": "explicit" }),
    });

    const config = await loadConfig(r.dir, { file: "config/custom.json" });

    expect(config.hooks).toEqual({ "pre-push": "explicit" });
  });

  it("reads the nano-hooks key when the file is a package.json", async () => {
    const r = repo({ "sub/package.json": json({ "nano-hooks": { "pre-commit": "x" } }) });

    expect((await loadConfig(r.dir, { file: "sub/package.json" })).hooks).toEqual({
      "pre-commit": "x",
    });
  });

  it("rejects a file that does not exist", async () => {
    await expect(loadConfig(repo({}).dir, { file: "nope.json" })).rejects.toThrow(
      "Configuration file nope.json not found.",
    );
  });

  it.each(["config.js", "config.mjs", "config.yaml"])("rejects %s", async (name) => {
    const r = repo({ [name]: "x" });

    await expect(loadConfig(r.dir, { file: name })).rejects.toThrow(
      `${name}: nano-hooks reads only JSON configuration files.`,
    );
  });

  it("rejects a package.json without a nano-hooks key", async () => {
    const r = repo({ "package.json": json({ name: "x" }) });

    await expect(loadConfig(r.dir, { file: "package.json" })).rejects.toThrow(
      'package.json has no "nano-hooks" key.',
    );
  });

  it("names the file in validation errors", async () => {
    const r = repo({ "custom.json": json({ "pre-comit": "x" }) });

    await expect(loadConfig(r.dir, { file: "custom.json" })).rejects.toThrow(
      "Invalid nano-hooks configuration in custom.json:",
    );
  });
});

describe("hookParts", () => {
  it("treats a command or a list as the run of an object", () => {
    expect(hookParts("a")).toEqual({ run: "a" });
    expect(hookParts(["a", "b"])).toEqual({ run: ["a", "b"] });
    expect(hookParts({ run: "a", bail: true })).toEqual({ run: "a", bail: true });
    expect(hookParts(undefined)).toEqual({});
  });
});
