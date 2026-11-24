import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { VALID_HOOKS, loadConfig } from "../src/config.js";
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
    const r = repo({
      "package.json": json({ "nano-hooks": { hooks: { "pre-commit": "echo hi" } } }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "echo hi" },
      preserveUnused: false,
      options: {},
    });
  });

  it.each(["nano-hooks.config.json", ".nano-hooks.json"])("reads %s", async (name) => {
    const r = repo({ [name]: json({ hooks: { "commit-msg": "a" } }) });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it("ignores a package.json without the nano-hooks key", async () => {
    const r = repo({
      "package.json": json({ name: "x" }),
      ".nano-hooks.json": json({ hooks: { "commit-msg": "a" } }),
    });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it.each([
    ["package.json", "nano-hooks.config.json"],
    ["package.json", ".nano-hooks.json"],
    ["nano-hooks.config.json", ".nano-hooks.json"],
  ])("rejects a project with both %s and %s", async (first, second) => {
    const config = { hooks: { "pre-commit": "x" } };
    const contents = {
      "package.json": json({ "nano-hooks": config }),
      "nano-hooks.config.json": json(config),
      ".nano-hooks.json": json(config),
    };
    const r = repo({ [first]: contents[first], [second]: contents[second] });

    await expect(loadConfig(r.dir)).rejects.toThrow(
      `Found more than one nano-hooks configuration: ${first}, ${second}.`,
    );
  });

  it("returns empty defaults when no config exists", async () => {
    const r = repo({ "package.json": json({ name: "x" }) });

    expect(await loadConfig(r.dir)).toEqual({ hooks: {}, preserveUnused: false, options: {} });
  });

  it("accepts a relative schema path without resolving it", async () => {
    const r = repo({
      ".nano-hooks.json": json({ $schema: "./missing-schema.json", hooks: {} }),
    });

    expect(await loadConfig(r.dir)).toEqual({ hooks: {}, preserveUnused: false, options: {} });
  });

  it("keeps each hook as written", async () => {
    const r = repo({
      ".nano-hooks.json": json({
        hooks: {
          "pre-commit": ["nano-hooks staged", "tsc"],
          "commit-msg": "x",
          "pre-push": ["a", "b"],
        },
      }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: {
        "pre-commit": ["nano-hooks staged", "tsc"],
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

  it("reports invalid preserveUnused entries by index without coercing their values", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        options: { preserveUnused: [{ toString: null }, "pre-comit"] },
      }),
    });

    expect(message).toContain("options.preserveUnused[0]: must be a git hook name string");
    expect(message).toContain('options.preserveUnused[1]: unknown git hook "pre-comit"');
  });

  it("rejects an options section that is not an object", async () => {
    const message = await problems({ ".nano-hooks.json": json({ options: true }) });

    expect(message).toContain("options: must be an object");
  });

  it("accepts a list of commands for a hook", async () => {
    const r = repo({
      ".nano-hooks.json": json({ hooks: { "pre-push": ["pnpm lint", "pnpm test"] } }),
    });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "pre-push": ["pnpm lint", "pnpm test"] });
  });

  it.each([[[]], [""], [" \t"], [5]])("rejects the hook value %j", async (v) => {
    const message = await problems({ ".nano-hooks.json": json({ hooks: { "pre-push": v } }) });

    expect(message).toContain("hooks.pre-push: must be a command or a non-empty list of commands");
  });

  it("reports each invalid command with its list index", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        hooks: { "pre-push": ["ok", "", 5] },
        staged: { "*.js": ["ok", " \n"] },
      }),
    });

    expect(message).toContain("hooks.pre-push[1]: must be a non-blank command string");
    expect(message).toContain("hooks.pre-push[2]: must be a non-blank command string");
    expect(message).toContain('staged["*.js"][1]: must be a non-blank command string');
  });
});

const top = (staged) => ({ ".nano-hooks.json": json({ staged }) });

describe("top-level staged key", () => {
  it("reads the top-level staged key next to the hooks", async () => {
    const staged = { "*.js": "eslint", "*.css": ["a", "b"] };
    const r = repo({
      ".nano-hooks.json": json({ hooks: { "pre-commit": "nano-hooks staged" }, staged }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "nano-hooks staged" },
      staged,
      preserveUnused: false,
      options: {},
    });
  });

  it("reports problems in the top-level staged key", async () => {
    const message = await problems(top({ "*.js": 5, "*.css": [], "!(a).js": "fmt", "": "fmt" }));

    expect(message).toContain('staged["*.js"]: must be a command or a non-empty list of commands');
    expect(message).toContain('staged["*.css"]: must be a command or a non-empty list of commands');
    expect(message).toContain('staged["!(a).js"]: "!(" groups are not supported');
    expect(message).toContain('staged[""]: glob pattern must not be empty');
  });

  it("rejects an empty top-level staged key and one that is not an object", async () => {
    expect(await problems(top({}))).toContain("staged: must have at least one pattern");
    expect(await problems(top("eslint"))).toContain(
      "staged: must be an object mapping glob patterns to commands",
    );
  });
});

const pre = (value) => ({ ".nano-hooks.json": json({ hooks: { "pre-commit": value } }) });

describe("hook objects", () => {
  it.each([[{ run: "x" }], [{ staged: { "*": "y" } }], [{ run: "x", bail: true }], [{}]])(
    "rejects the hook object %j and shows the new shape",
    async (value) => {
      const message = await problems(pre(value));

      expect(message).toContain(
        "hooks.pre-commit: an object is not allowed. Use a command or a list of commands.",
      );
      expect(message).toContain(
        'Move "staged" to the top level, and move allowEmpty, bail, parallel and restage to "options".',
      );
    },
  );
});

describe("invalid configuration", () => {
  it("rejects a server-side hook and an option at the top level", async () => {
    const message = await problems({
      ".nano-hooks.json": json({ hooks: { "pre-receive": "x" }, preserveUnused: true }),
    });

    expect(message).toContain('hooks.pre-receive: unknown git hook "pre-receive"');
    expect(message).toContain(
      "preserveUnused: unknown key (expected options, hooks, staged or $schema)",
    );
  });

  it.each([[null], [[]], ["echo hi"]])("rejects a hooks section of %j", async (hooks) => {
    const message = await problems({ ".nano-hooks.json": json({ hooks }) });

    expect(message).toContain("hooks: must be an object");
  });

  it("points a top-level hook to its new location", async () => {
    const message = await problems({
      ".nano-hooks.json": json({ "pre-commit": "x", hooks: { "pre-push": "y" } }),
    });

    expect(message).toContain('pre-commit: move this hook to "hooks.pre-commit"');
  });

  it("reports every problem at once, with a list of the valid hooks for a misspelled one", async () => {
    const message = await problems({
      ".nano-hooks.json": json({ hooks: { "pre-comit": "x", "commit-msg": "" }, foo: 1 }),
    });

    expect(message).toContain('hooks.pre-comit: unknown git hook "pre-comit"');
    expect(message).toContain(
      "hooks.commit-msg: must be a command or a non-empty list of commands",
    );
    expect(message).toContain("foo: unknown key");
    expect(message).toContain(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  });

  it("rejects a configuration that is not an object", async () => {
    expect(await problems({ ".nano-hooks.json": json([]) })).toContain(
      "configuration must be an object",
    );
  });

  it("rejects an invalid schema reference", async () => {
    const message = await problems({ ".nano-hooks.json": json({ $schema: "  " }) });

    expect(message).toContain("$schema: must be a non-blank string");
  });

  it("reports a valid JSON package.json with an invalid root", async () => {
    const r = repo({ "package.json": "null" });

    await expect(loadConfig(r.dir)).rejects.toThrow("package.json must contain an object");
    await expect(loadConfig(r.dir, { file: "package.json" })).rejects.toThrow(
      "package.json must contain an object",
    );
  });

  it("names the file when the config cannot be parsed", async () => {
    const message = await problems({ ".nano-hooks.json": "{ not json" });

    expect(message).toMatch(/^Failed to read .*\.nano-hooks\.json: /u);
  });
});

describe("JSON Schema", () => {
  it("matches the generated schema", () => {
    const script = fileURLToPath(new URL("../scripts/generate-schema.js", import.meta.url));

    expect(() => execFileSync(process.execPath, [script, "--check"])).not.toThrow();
  });
});

describe("loadConfig with an explicit file", () => {
  it("loads it instead of discovering one, relative to cwd", async () => {
    const r = repo({
      ".nano-hooks.json": json({ hooks: { "pre-commit": "discovered" } }),
      "config/custom.json": json({ hooks: { "pre-push": "explicit" } }),
    });

    const config = await loadConfig(r.dir, { file: "config/custom.json" });

    expect(config.hooks).toEqual({ "pre-push": "explicit" });
  });

  it("reads the nano-hooks key when the file is a package.json", async () => {
    const r = repo({
      "sub/package.json": json({ "nano-hooks": { hooks: { "pre-commit": "x" } } }),
    });

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
    const r = repo({ "custom.json": json({ hooks: { "pre-comit": "x" } }) });

    await expect(loadConfig(r.dir, { file: "custom.json" })).rejects.toThrow(
      "Invalid nano-hooks configuration in custom.json:",
    );
  });
});
