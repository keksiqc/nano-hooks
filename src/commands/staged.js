// The staged-file runner is based on nano-staged (MIT), see LICENSE.
import { realpathSync } from "node:fs";
import { styleText } from "node:util";
import { loadConfig } from "../config.js";
import { EmptyCommitError, runWithBackup } from "../backup.js";
import { createGit } from "../git.js";
import { quote } from "../hooks.js";
import { log } from "../log.js";
import { createRenderer } from "../renderer.js";
import { CommandError, createCommandGroups, runCommandGroups } from "../tasks.js";

/**
 * Run the configured commands on the staged files, keeping the working tree safe: unstaged
 * changes are set aside while commands run, their modifications are added back, and
 * everything is restored if a command fails.
 * @returns {Promise<boolean>} false when no staged file matched any pattern
 * @throws {AggregateError} with one error per failed step
 */
async function runTasks({
  allowEmpty,
  gitPaths,
  config,
  stream,
  files,
  cwd,
  quiet,
  bail,
  concurrent,
}) {
  const groups = await createCommandGroups({
    config,
    files: files.working,
    cwd,
    rootPath: gitPaths.root,
  });
  if (!groups.some((group) => group.fileCount > 0)) return false;

  const renderer = createRenderer(stream, {
    isTTY: Boolean(stream.isTTY) && !process.env.CI,
    quiet,
  });
  try {
    await runWithBackup({
      allowEmpty,
      rootPath: gitPaths.root,
      dotPath: gitPaths.dot,
      files,
      execute: {
        tasks: groups,
        run: () => runCommandGroups(groups, { bail, concurrent }),
      },
      onStep: (step) => renderer.start(step),
    });
  } finally {
    renderer.stop();
  }
  return true;
}

/**
 * Git reports canonical paths (symlinks and Windows 8.3 short names resolved) and file
 * matching compares them with cwd, so cwd has to be canonical too.
 */
function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Tell how to allow an empty commit, which only this command knows. */
function advise(error) {
  return error instanceof EmptyCommitError
    ? new Error(`${error.message} Use --allow-empty to allow it.`, { cause: error })
    : error;
}

/** The failed commands with their output, styled for a terminal. */
function formatFailures(failures) {
  return failures
    .map(
      ({ pattern, title, message }) =>
        `${styleText("red", pattern)} ${styleText("dim", ">")} ${styleText("red", title)}:\n${message}`,
    )
    .join("\n\n");
}

/** Command output is already formatted; anything else is a plain error line. */
function report(error, stream) {
  if (error instanceof CommandError) stream.write(`\n${formatFailures(error.failures)}\n`);
  else log.error(error?.message ?? String(error), { markup: false, stream });
}

/**
 * Run commands on the staged files, as configured by glob pattern. Failures are reported to
 * `stream` and then rethrown, as an `AggregateError` when several steps failed.
 * @param {object} options
 * @param {Record<string, string | string[] | Function>} options.config glob pattern to
 * command, list of commands or function returning them
 * @param {string} [options.cwd] only staged files below this directory are processed
 * @param {boolean} [options.allowEmpty] allow a commit that is empty once the commands ran
 * @param {boolean} [options.bail] stop after the first failing command
 * @param {boolean} [options.concurrent] run the patterns side by side (default) or one by one
 * @param {boolean} [options.quiet] do not draw task progress
 * @param {NodeJS.WriteStream} [options.stream] where progress and errors go, stderr by default
 */
export async function runStaged({
  config,
  cwd = process.cwd(),
  allowEmpty = false,
  bail = false,
  concurrent = true,
  quiet = false,
  stream = process.stderr,
} = {}) {
  try {
    if (!config) {
      throw new Error(
        'No staged tasks configured. Add a "staged" section to your nano-hooks configuration.',
      );
    }

    cwd = canonical(cwd);
    const gitPaths = await createGit(cwd).getGitPaths();
    if (!gitPaths.root) throw new Error("Not a git repository.");

    const files = await createGit(gitPaths.root).stagedFiles();
    if (!files.working.length) {
      log.info("No staged files found.", { stream });
      return;
    }

    const ran = await runTasks({
      allowEmpty,
      gitPaths,
      config,
      stream,
      files,
      cwd,
      quiet,
      bail,
      concurrent,
    });
    if (!ran) log.info("No files match any configured task.", { stream });
  } catch (error) {
    const causes = (error instanceof AggregateError ? error.errors : [error]).map(advise);
    for (const cause of causes) report(cause, stream);
    throw error instanceof AggregateError ? new AggregateError(causes, error.message) : causes[0];
  }
}

/**
 * The configured hook commands, plus the default `pre-commit` that runs this command when
 * `staged` is configured and `pre-commit` is not. Installed hooks and `run` share this.
 * `cd` is a prefix for that default command, for hooks that start in another directory.
 * The `nano-hooks` command comes from `node_modules/.bin`, which the hook puts on PATH.
 * The staged config may live in a sub-package, and a custom config has to be named
 * explicitly because hooks run later, from another directory.
 * @param {{ hooks?: Record<string, string | string[]>, staged?: object }} loaded
 * @param {string} [config] the config file of the project, if it is not discovered
 * @param {string} [cd]
 */
export function withDefaultHooks({ hooks: configured, staged }, config, cd = "") {
  const hooks = { ...configured };

  if (!hooks["pre-commit"] && staged) {
    const flag = config ? ` --config ${quote(config)}` : "";
    hooks["pre-commit"] = `${cd}nano-hooks staged${flag}`;
  }
  return hooks;
}

/** @type {import("./index.js").Command} */
export const command = {
  name: "staged",
  description: "Run commands on staged files",
  flags: [
    {
      flags: ["--allow-empty"],
      name: "allowEmpty",
      value: true,
      description: "Allow empty commits",
    },
    {
      flags: ["--bail"],
      name: "bail",
      value: true,
      description: "Stop after the first failing command",
    },
    {
      flags: ["--no-concurrent"],
      name: "concurrent",
      value: false,
      description: "Run the patterns one after the other",
    },
  ],
  note: 'These options can also be set in the "options" section of the configuration.\nA command line option wins over the configuration.',
  async run({ options }) {
    const { staged: tasks, options: configured } = await loadConfig(process.cwd(), {
      file: options.config,
    });
    // A command line option wins over the configuration.
    const { allowEmpty, bail, concurrent } = { ...configured, ...options };
    // Let rollback finish if the user interrupts a running commit.
    process.on("SIGINT", () => {});
    try {
      await runStaged({ config: tasks, allowEmpty, bail, concurrent });
    } catch {
      // runStaged has already reported the errors.
      return 1;
    }
    return 0;
  },
};
