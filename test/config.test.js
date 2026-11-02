import { afterEach, describe, expect, it } from "vitest";
import { VALID_HOOKS, loadConfig } from "../src/config.js";
import { createRepo } from "./helpers.js";

const repos = [];
function repo(files) {
  const r = createRepo(files);
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

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
    });
  });

  it("prefers .nano-hooks.json over package.json", async () => {
    const r = repo({
      ".nano-hooks.json": json({ hooks: { "commit-msg": "a" } }),
      "package.json": json({ "nano-hooks": { hooks: { "pre-commit": "b" } } }),
    });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it("loads the .nano-hooks.mjs default export, keeping function tasks", async () => {
    const task = "({ filenames }) => []";
    const r = repo({
      ".nano-hooks.mjs": `export default { hooks: { "pre-push": "echo push" }, staged: { "*.js": ${task} } };\n`,
    });

    const config = await loadConfig(r.dir);

    expect(config.hooks).toEqual({ "pre-push": "echo push" });
    expect(typeof config.staged["*.js"]).toBe("function");
  });

  it("returns empty defaults when no config exists", async () => {
    const r = repo({ "package.json": json({ name: "x" }) });

    expect(await loadConfig(r.dir)).toEqual({ hooks: {}, preserveUnused: false });
  });

  it("reads all three sections", async () => {
    const r = repo({
      ".nano-hooks.json": json({
        hooks: { "pre-commit": "x" },
        staged: { "*.js": "eslint", "*.css": ["a", "b"] },
        preserveUnused: ["commit-msg"],
      }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "x" },
      staged: { "*.js": "eslint", "*.css": ["a", "b"] },
      preserveUnused: ["commit-msg"],
    });
  });

  it("reports every problem at once with the file name and key paths", async () => {
    const message = await problems({
      ".nano-hooks.json": json({
        hooks: { "pre-comit": "x", "commit-msg": "" },
        preserveUnused: "yes",
        staged: { "*.js": 5 },
        foo: 1,
      }),
    });

    expect(message.split("\n")[0]).toBe("Invalid nano-hooks configuration in .nano-hooks.json:");
    expect(message).toContain("hooks.pre-comit: unknown git hook");
    expect(message).toContain("hooks.commit-msg: must be a non-empty command string");
    expect(message).toContain("preserveUnused: must be true, false or a list of hook names");
    expect(message).toContain(
      'staged["*.js"]: must be a command, a list of commands or a function',
    );
    expect(message).toContain("foo: unknown option (expected hooks, staged or preserveUnused)");
    expect(message).toContain(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  });

  it("points top-level hook names at the hooks section", async () => {
    const message = await problems({ ".nano-hooks.json": json({ "pre-commit": "x" }) });

    expect(message).toContain('pre-commit: hooks go under "hooks" (hooks.pre-commit)');
  });

  it("rejects unknown hook names in preserveUnused", async () => {
    const message = await problems({ ".nano-hooks.json": json({ preserveUnused: ["pre-comit"] }) });

    expect(message).toContain('preserveUnused[0]: unknown git hook "pre-comit"');
  });

  it("rejects an empty staged section", async () => {
    const message = await problems({ ".nano-hooks.json": json({ staged: {} }) });

    expect(message).toContain("staged: must have at least one pattern");
  });

  it("names the file when the config cannot be parsed", async () => {
    const message = await problems({ ".nano-hooks.json": "{ not json" });

    expect(message).toMatch(/^Failed to read .*\.nano-hooks\.json: /);
  });

  it("loads an explicit file instead of discovering one, relative to cwd", async () => {
    const r = repo({
      ".nano-hooks.json": json({ hooks: { "pre-commit": "discovered" } }),
      "config/custom.json": json({ hooks: { "pre-push": "explicit" } }),
    });

    const config = await loadConfig(r.dir, { file: "config/custom.json" });

    expect(config.hooks).toEqual({ "pre-push": "explicit" });
  });

  it("reads the nano-hooks key when the explicit file is a package.json", async () => {
    const r = repo({
      "sub/package.json": json({ "nano-hooks": { hooks: { "pre-commit": "x" } } }),
    });

    expect((await loadConfig(r.dir, { file: "sub/package.json" })).hooks).toEqual({
      "pre-commit": "x",
    });
  });

  it("rejects an explicit file that does not exist", async () => {
    const r = repo({});

    await expect(loadConfig(r.dir, { file: "nope.json" })).rejects.toThrow(
      "Configuration file nope.json not found.",
    );
  });

  it("rejects an explicit package.json without a nano-hooks key", async () => {
    const r = repo({ "package.json": json({ name: "x" }) });

    await expect(loadConfig(r.dir, { file: "package.json" })).rejects.toThrow(
      'package.json has no "nano-hooks" key.',
    );
  });

  it("names the explicit file in validation errors", async () => {
    const r = repo({ "custom.json": json({ hooks: { "pre-comit": "x" } }) });

    await expect(loadConfig(r.dir, { file: "custom.json" })).rejects.toThrow(
      "Invalid nano-hooks configuration in custom.json:",
    );
  });

  it("lists git's documented hook names", () => {
    expect(VALID_HOOKS).toContain("pre-commit");
    expect(VALID_HOOKS).toContain("commit-msg");
  });
});
