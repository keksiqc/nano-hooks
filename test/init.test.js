import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { init } from "../src/commands/init.js";
import { createRepo, createTempDir } from "./helpers.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const repos = [];
function repo(files) {
  const r = createRepo(files);
  repos.push(r);
  return r;
}
afterEach(() => repos.splice(0).forEach((r) => r.cleanup()));

const pkg = (value, indent = 2) => `${JSON.stringify(value, null, indent)}\n`;
const manifest = (r) => JSON.parse(r.read("package.json"));
const nano = (r, ...args) => spawnSync("node", [CLI, ...args], { cwd: r.dir, encoding: "utf8" });

describe("init", () => {
  it("adds a pre-commit hook and a prepare script", async () => {
    const r = repo({ "package.json": pkg({ name: "x", scripts: { lint: "oxlint" } }) });

    const result = await init({ cwd: r.dir });

    expect(result).toEqual({ command: "npm run lint", prepare: "added" });
    expect(manifest(r)).toEqual({
      name: "x",
      scripts: { lint: "oxlint", prepare: "nano-hooks" },
      "nano-hooks": { hooks: { "pre-commit": "npm run lint" } },
    });
  });

  it("uses a command that you give", async () => {
    const r = repo({ "package.json": pkg({ name: "x" }) });

    await init({ cwd: r.dir, command: "pnpm test" });

    expect(manifest(r)["nano-hooks"].hooks["pre-commit"]).toBe("pnpm test");
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm run lint"],
    ["yarn.lock", "yarn run lint"],
    ["bun.lock", "bun run lint"],
  ])("picks the package manager from %s", async (lockfile, expected) => {
    const r = repo({ "package.json": pkg({ name: "x" }), [lockfile]: "" });

    expect((await init({ cwd: r.dir })).command).toBe(expected);
  });

  it("prefers the packageManager field over a lockfile", async () => {
    const r = repo({
      "package.json": pkg({ name: "x", packageManager: "pnpm@10.0.0" }),
      "yarn.lock": "",
    });

    expect((await init({ cwd: r.dir })).command).toBe("pnpm run lint");
  });

  it("keeps a prepare script that already runs nano-hooks", async () => {
    const r = repo({ "package.json": pkg({ scripts: { prepare: "nano-hooks && build" } }) });

    expect((await init({ cwd: r.dir })).prepare).toBe("kept");
    expect(manifest(r).scripts.prepare).toBe("nano-hooks && build");
  });

  it("appends nano-hooks to another prepare script", async () => {
    const r = repo({ "package.json": pkg({ scripts: { prepare: "tsc" } }) });

    expect((await init({ cwd: r.dir })).prepare).toBe("appended");
    expect(manifest(r).scripts.prepare).toBe("tsc && nano-hooks");
  });

  it("keeps the indentation and the final newline", async () => {
    const r = repo({ "package.json": JSON.stringify({ name: "x" }, null, "\t") });

    await init({ cwd: r.dir });

    const text = r.read("package.json");
    expect(text).toContain('\n\t"name": "x"');
    expect(text.endsWith("\n")).toBe(false);
  });

  it("does not change an existing configuration", async () => {
    const r = repo({ "package.json": pkg({ name: "x" }), ".nano-hooks.json": "{}" });
    const before = r.read("package.json");

    await expect(init({ cwd: r.dir })).rejects.toThrow(/already configured in \.nano-hooks\.json/);
    expect(r.read("package.json")).toBe(before);
  });

  it("needs a package.json", async () => {
    const t = createTempDir();

    await expect(init({ cwd: t.dir })).rejects.toThrow(/No package\.json found/);
    t.cleanup();
  });

  it("reports a package.json that is not valid JSON", async () => {
    const r = repo({ "package.json": "{ nope" });

    await expect(init({ cwd: r.dir })).rejects.toThrow(/Failed to read .*package\.json/);
  });
});

describe("nano-hooks init", () => {
  it("writes the configuration and installs the hook", () => {
    const r = repo({ "package.json": pkg({ name: "x" }) });

    const result = nano(r, "init", "node", "-e", "process.exit(0)");

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Added the nano-hooks key to package.json");
    expect(result.stderr).toContain("Installed pre-commit");
    expect(manifest(r)["nano-hooks"].hooks["pre-commit"]).toBe("node -e process.exit(0)");
    expect(readFileSync(join(r.dir, ".git/hooks/pre-commit"), "utf8")).toContain(
      "node -e process.exit(0)",
    );
  });

  it("uses the default command without arguments", () => {
    const r = repo({ "package.json": pkg({ name: "x" }) });

    expect(nano(r, "init").status).toBe(0);
    expect(manifest(r)["nano-hooks"].hooks["pre-commit"]).toBe("npm run lint");
  });

  it("exits 1 and changes nothing when a configuration exists", () => {
    const r = repo({ "package.json": pkg({ name: "x" }), ".nano-hooks.json": "{}" });

    const result = nano(r, "init");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already configured in .nano-hooks.json");
    expect(existsSync(join(r.dir, ".git/hooks/pre-commit"))).toBe(false);
  });

  it("treats words after init as the command, even when they look like options", () => {
    const r = repo({ "package.json": pkg({ name: "x" }) });

    expect(nano(r, "init", "pnpm", "run", "lint", "--fix").status).toBe(0);
    expect(manifest(r)["nano-hooks"].hooks["pre-commit"]).toBe("pnpm run lint --fix");
  });
});
