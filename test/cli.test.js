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
const fmtConfig = JSON.stringify({ "*.js": "node fmt.js" });

describe("nano-hooks staged", () => {
  it("formats staged files and exits 0", () => {
    const r = repo({ "a.js": "one\n", ".nano-staged.json": fmtConfig });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("prints no cursor control sequences when stderr is not a TTY", () => {
    const r = repo({ "a.js": "one\n", ".nano-staged.json": fmtConfig });
    stage(r, "a.js", "uno\n");

    const result = nano(r, "staged");

    expect(result.stderr).not.toContain("\x1b[?25");
  });

  it("exits 1 when a command fails", () => {
    const r = repo({
      "a.js": "one\n",
      ".nano-staged.json": JSON.stringify({ "*.js": "node fail.js" }),
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
    expect(result.stderr).toMatch(/Create Nano Staged config/);
  });

  it("--config points at a specific file", () => {
    const r = repo({ "a.js": "one\n", "custom.json": fmtConfig });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--config", "custom.json").status).toBe(0);
    expect(r.git("show", ":a.js")).toBe("UNO\n");
  });

  it("--allow-empty lets an emptied commit through", () => {
    const r = repo({
      "a.js": "x\n",
      ".nano-staged.json": JSON.stringify({ "*.js": "node reset.js" }),
    });
    stage(r, "a.js", "y\n");

    expect(nano(r, "staged").status).toBe(1);
    expect(nano(r, "staged", "--allow-empty").status).toBe(0);
  });

  it("--bail is accepted", () => {
    const r = repo({ "a.js": "one\n", ".nano-staged.json": fmtConfig });
    stage(r, "a.js", "uno\n");

    expect(nano(r, "staged", "--bail").status).toBe(0);
  });
});

describe("nano-hooks install / uninstall", () => {
  it("install writes hooks and uninstall removes them", () => {
    const r = repo({ ".nano-hooks.json": JSON.stringify({ "pre-commit": "echo a" }) });
    const hook = join(r.dir, ".git/hooks/pre-commit");

    expect(nano(r).status).toBe(0);
    expect(existsSync(hook)).toBe(true);

    expect(nano(r, "uninstall").status).toBe(0);
    expect(existsSync(hook)).toBe(false);
  });

  it("install reports an error outside a git repository", () => {
    const r = repo();
    const result = spawnSync("node", [CLI, "install"], {
      cwd: join(r.dir, ".."),
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a git repository/);
  });
});

describe("nano-hooks usage", () => {
  it("unknown command exits 1 and prints usage", () => {
    const result = nano(repo(), "frobnicate");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: nano-hooks");
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
      "package.json": JSON.stringify({ "nano-staged": { "*.js": "node fmt.js" } }),
    });
    expect(nano(r, "install").status).toBe(0);
    stage(r, "a.js", "uno\n");

    r.git("commit", "-q", "-m", "x");

    expect(r.git("show", "HEAD:a.js")).toBe("UNO\n");
  });
});
