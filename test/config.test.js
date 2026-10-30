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

describe("loadConfig", () => {
  it("reads the nano-hooks key from package.json", async () => {
    const r = repo({
      "package.json": JSON.stringify({ "nano-hooks": { "pre-commit": "echo hi" } }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "echo hi" },
      preserveUnused: false,
    });
  });

  it("prefers .nano-hooks.json over package.json", async () => {
    const r = repo({
      ".nano-hooks.json": JSON.stringify({ "commit-msg": "a" }),
      "package.json": JSON.stringify({ "nano-hooks": { "pre-commit": "b" } }),
    });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "commit-msg": "a" });
  });

  it("loads the .nano-hooks.mjs default export", async () => {
    const r = repo({ ".nano-hooks.mjs": `export default { "pre-push": "echo push" };\n` });

    expect((await loadConfig(r.dir)).hooks).toEqual({ "pre-push": "echo push" });
  });

  it("returns empty hooks when no config exists", async () => {
    const r = repo({ "package.json": JSON.stringify({ name: "x" }) });

    expect(await loadConfig(r.dir)).toEqual({ hooks: {}, preserveUnused: false });
  });

  it("separates preserveUnused from hooks", async () => {
    const r = repo({
      ".nano-hooks.json": JSON.stringify({ "pre-commit": "x", preserveUnused: ["commit-msg"] }),
    });

    expect(await loadConfig(r.dir)).toEqual({
      hooks: { "pre-commit": "x" },
      preserveUnused: ["commit-msg"],
    });
  });

  it("rejects an unknown hook name", async () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-comit": "x" }) });

    await expect(loadConfig(r.dir)).rejects.toThrow("pre-comit");
  });

  it("rejects a non-string command", async () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": ["x"] }) });

    await expect(loadConfig(r.dir)).rejects.toThrow("pre-commit");
  });

  it("lists git's documented hook names", () => {
    expect(VALID_HOOKS).toContain("pre-commit");
    expect(VALID_HOOKS).toContain("commit-msg");
  });
});
