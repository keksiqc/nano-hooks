import { copyFileSync, existsSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { run } from "./exec.js";

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

/**
/** Parse `git status -z` into `{ x, y, path }`: the index and worktree letters and the path. */
function parseStatus(raw) {
  const fields = raw.split("\0");
  const entries = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;

    const [x, y] = field;
    // Renames and copies are followed by a field with the original path.
    if (x === "R" || x === "C") i++;
    entries.push({ x, y, path: field.slice(3) });
  }

  return entries.filter((entry) => !entry.path.endsWith("/"));
}

/** Like `realpathSync`, but the path may not exist yet: the existing part is resolved. */
function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : resolve(realPath(parent), basename(path));
  }
}

const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/**
/** Bind the git helpers to a directory. */
export function createGit(cwd = process.cwd()) {
  const exec = (args, options = {}) => run("git", args, { cwd, ...options });

  /** The hooks directory, honouring `core.hooksPath` and worktrees. `external`: outside .git. */
  const hooksInfo = async () => {
    try {
      const out = await exec(["rev-parse", "--git-path", "hooks", "--git-common-dir"]);
      const [hooks, common] = out.split(/\r?\n/);
      const dir = resolve(cwd, hooks);
      return { dir, external: !isInside(realPath(resolve(cwd, common)), realPath(dir)) };
    } catch (error) {
      if (/not a git repository/i.test(error.message)) {
        throw new NotGitRepositoryError(`Not a git repository: ${cwd}`, { cause: error });
      }
      throw error;
    }
  };

  return {
    exec,
    hooksInfo,

    /** The top-level directory of the working tree, where git runs most hooks. */
    async toplevel() {
      return (await exec(["rev-parse", "--show-toplevel"])).trim();
    },

    async hooksDir() {
      return (await hooksInfo()).dir;
    },

    /** The repository root and git directory, or nulls outside a repository. */
    async getGitPaths() {
      // Git sets these in some hooks; they would point later commands at the wrong place.
      delete process.env.GIT_DIR;
      delete process.env.GIT_WORK_TREE;

      try {
        const out = await exec(["rev-parse", "--show-toplevel", "--absolute-git-dir"]);
        const [root, dot] = out.split(/\r?\n/);
        return root && dot
          ? { root: normalize(root), dot: normalize(dot) }
          : { root: null, dot: null };
      } catch {
        return { root: null, dot: null };
      }
    },

    async diff(output, files = []) {
      await exec([
        "diff",
        ...DIFF_ARGS,
        "--output",
        output,
        ...(files.length ? ["--", ...files] : []),
      ]);
    },

    async apply(patch, { threeWay = false } = {}) {
      await exec(["apply", ...APPLY_ARGS, ...(threeWay ? ["-3"] : []), patch]);
    },

    async add(paths) {
      if (paths.length) await exec(["add", "-A", "--", ...paths]);
    },

    /** Whether adding `paths` would make the index differ from HEAD. Uses a copy of the index. */
    async wouldChange(paths) {
      const index = resolve(cwd, (await exec(["rev-parse", "--git-path", "index"])).trim());
      const copy = `${index}.nano-hooks-check`;
      const env = { GIT_INDEX_FILE: copy };
      try {
        if (existsSync(index)) copyFileSync(index, copy);
        if (paths.length) await exec(["add", "-A", "--", ...paths], { env });
        return (await exec(["diff", "--cached", "--name-only"], { env })).trim() !== "";
      } finally {
        rmSync(copy, { force: true });
      }
    },

    async checkout(paths) {
      if (paths.length) await exec(["checkout", "-q", "--force", "--", ...paths]);
    },

    /**
     * The staged files, relative to the repository root: `working` (still exist), `changed`
     * (also modified unstaged) and `deleted` (deleted from the worktree only).
     */
    async stagedFiles() {
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
    },
  };
}
