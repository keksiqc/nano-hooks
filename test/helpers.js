import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished } from "vitest";

export const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));

export const FMT = `const fs = require("node:fs");
for (const file of process.argv.slice(2)) {
  const [first, ...rest] = fs.readFileSync(file, "utf8").split("\\n");
  fs.writeFileSync(file, [first.toUpperCase(), ...rest].join("\\n"));
}
`;
export const FAIL = `process.exit(1);\n`;
export const RESET = `require("node:fs").writeFileSync("a.js", "x\\n");\n`;
export const MARK = `require("node:fs").writeFileSync("marker", "1");\n`;

/** Put a `nano-hooks` command in `<dir>/node_modules/.bin`, as a package manager would. */
export function linkCli(dir) {
  const bin = join(dir, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "nano-hooks"), `#!/bin/sh\nexec node '${CLI}' "$@"\n`);
  chmodSync(join(bin, "nano-hooks"), 0o755);
}

/** Create an empty temp directory that is not a git repository. */
export function createTempDir(dirName = "work") {
  const root = mkdtempSync(join(tmpdir(), "nano-hooks-"));
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  return { dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * Create a temp git repo with an initial commit containing `files`.
 * `options.dirName` names the repo directory (to test unusual paths).
 */
export function createRepo(files = {}, options = {}) {
  const { dir, cleanup } = createTempDir(options.dirName);

  function git(...args) {
    return execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  function write(path, content) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, ".git", "info", "exclude"), "node_modules/\n");
  linkCli(dir);
  for (const [path, content] of Object.entries(files)) write(path, content);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "init");

  return { dir, git, write, read: (path) => readFileSync(join(dir, path), "utf8"), cleanup };
}

/** Like `createRepo`, and the repository is removed when the test ends. Call it in a test. */
export function testRepo(files, options) {
  const r = createRepo(files, options);
  onTestFinished(r.cleanup);
  return r;
}

/** Like `createTempDir`, and the directory is removed when the test ends. Call it in a test. */
export function testTempDir(dirName) {
  const t = createTempDir(dirName);
  onTestFinished(t.cleanup);
  return t;
}

/** Run the nano-hooks CLI in the repository and return the `spawnSync` result. */
export const nano = (r, ...args) => nanoWith(r, {}, ...args);

/** Like `nano`, with `spawnSync` options such as `cwd` or `env`. `env` adds to the environment. */
export function nanoWith(r, { env, ...options }, ...args) {
  return spawnSync("node", [CLI, ...args], {
    cwd: r.dir,
    encoding: "utf8",
    ...options,
    env: { ...process.env, ...env },
  });
}
