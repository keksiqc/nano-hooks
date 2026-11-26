import { constants, copyFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { normalize, resolve } from "node:path";

import { run } from "./exec.js";
import { isInside, realPath } from "./paths.js";

const APPLY_ARGS = ["-v", "--whitespace=nowarn", "--recount", "--unidiff-zero"];
const DIFF_ARGS = [
  "--binary",
  "--unified=0",
  "--no-color",
  "--no-ext-diff",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--patch",
  "--submodule=short",
];

/** Thrown when a command needs a git repository and the directory is not inside one. */
export class NotGitRepositoryError extends Error {
  name = "NotGitRepositoryError";
}

function parseStatus(raw) {
  const fields = raw.split("\0");
  const entries = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;

    const [x, y] = field;
    if (x === "R" || x === "C") i++;
    entries.push({ x, y, path: field.slice(3) });
  }

  return entries.filter((entry) => !entry.path.endsWith("/"));
}

async function readHooksInfo(cwd, exec) {
  try {
    const out = await exec(["rev-parse", "--git-path", "hooks", "--git-common-dir"]);
    const [hooks, common] = out.split(/\r?\n/u);
    const dir = resolve(cwd, hooks);
    return { dir, external: !isInside(realPath(resolve(cwd, common)), realPath(dir)) };
  } catch (error) {
    if (/not a git repository/iu.test(error.message)) {
      throw new NotGitRepositoryError(`Not a git repository: ${cwd}`, { cause: error });
    }
    throw error;
  }
}

async function readGitPaths(exec) {
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;

  try {
    const out = await exec(["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
    const [root, dot] = out.split(/\r?\n/u);
    return root && dot
      ? { root: normalize(root), gitDir: normalize(dot) }
      : { root: null, gitDir: null };
  } catch {
    return { root: null, gitDir: null };
  }
}

async function readIndexPath(cwd, exec) {
  const path = await exec(["rev-parse", "--git-path", "index"]);
  return realPath(resolve(cwd, path.replace(/\r?\n$/u, "")));
}

/** Replace the index through Git's lock file, leaving any other writer's lock alone. */
function restoreIndex(snapshot, index) {
  const lock = `${index}.lock`;
  copyFileSync(snapshot, lock, constants.COPYFILE_EXCL);
  try {
    renameSync(lock, index);
  } catch (error) {
    rmSync(lock, { force: true });
    throw error;
  }
}

/**
 * Copy the index to `path`, which must not exist, and make the copy independent of any shared
 * index file that Git may expire. A failure leaves no file at `path` that this call made.
 * The result puts the copy back over the index it came from.
 */
async function snapshotIndex(cwd, exec, path) {
  const index = await readIndexPath(cwd, exec);
  copyFileSync(index, path, constants.COPYFILE_EXCL);
  try {
    const env = { GIT_INDEX_FILE: path };
    if ((await exec(["rev-parse", "--shared-index-path"], { env })).trim()) {
      await exec(["update-index", "--no-split-index"], { env });
    }
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
  return { restore: () => restoreIndex(path, index) };
}

async function checkWouldChange(index, exec, paths) {
  const copy = `${index}.nano-hooks-check`;
  const env = { GIT_INDEX_FILE: copy };
  try {
    if (existsSync(index)) copyFileSync(index, copy);
    if (paths.length > 0) await exec(["add", "-A", "--", ...paths], { env });
    return (await exec(["diff", "--cached", "--name-only"], { env })).trim() !== "";
  } finally {
    rmSync(copy, { force: true });
  }
}

async function readStagedFiles(exec) {
  const raw = await exec(["status", "-z", "-u"], { env: { GIT_OPTIONAL_LOCKS: "0" } });
  const working = new Set();
  const changed = [];
  const deleted = [];

  for (const { x, y, path } of parseStatus(raw)) {
    if (!"AMRC".includes(x) || working.has(path)) continue;

    working.add(path);
    if ("ACMR".includes(y)) changed.push(path);
    else if (y === "D") deleted.push(path);
  }

  return { working: [...working], changed, deleted };
}

/** Bind the git helpers to a directory. */
export function createGit(cwd = process.cwd()) {
  const exec = (args, options = {}) => run("git", args, { cwd, ...options });
  const hooksInfo = () => readHooksInfo(cwd, exec);

  return {
    hooksInfo,
    getGitPaths: () => readGitPaths(exec),
    snapshotIndex: (path) => snapshotIndex(cwd, exec, path),
    async wouldChange(paths) {
      return checkWouldChange(await readIndexPath(cwd, exec), exec, paths);
    },
    stagedFiles: () => readStagedFiles(exec),

    async toplevel() {
      return (await exec(["rev-parse", "--show-toplevel"])).trim();
    },

    async hooksDir() {
      return (await hooksInfo()).dir;
    },

    async diff(output, files = []) {
      const paths = files.length > 0 ? ["--", ...files] : [];
      await exec(["diff", ...DIFF_ARGS, "--output", output, ...paths]);
    },

    async apply(patch, { threeWay = false } = {}) {
      await exec(["apply", ...APPLY_ARGS, ...(threeWay ? ["-3"] : []), patch]);
    },

    async add(paths) {
      if (paths.length > 0) await exec(["add", "-A", "--", ...paths]);
    },

    async checkout(paths) {
      if (paths.length > 0) await exec(["checkout", "-q", "--force", "--", ...paths]);
    },
  };
}
