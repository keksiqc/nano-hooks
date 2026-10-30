import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
    return execFileSync("git", args, { cwd: dir, encoding: "utf8" });
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
  for (const [path, content] of Object.entries(files)) write(path, content);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "init");

  return { dir, git, write, read: (path) => readFileSync(join(dir, path), "utf8"), cleanup };
}
