// The staged-file runner is based on nano-staged (MIT), see LICENSE.
import { realpathSync } from "node:fs";
import { styleText } from "node:util";
import { STAGED_HOOK, hookParts } from "../config.js";
import { EmptyCommitError, runWithBackup } from "../backup.js";
import { createGit } from "../git.js";
import { createRenderer, log } from "../log.js";
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
  parallel,
  restage,
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
      restage,
      rootPath: gitPaths.root,
      dotPath: gitPaths.dot,
      files,
      execute: {
        tasks: groups,
        run: () => runCommandGroups(groups, { bail, parallel }),
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
  else log.error(error?.message ?? String(error), stream);
}

/**
 * Run commands on the staged files, as configured by glob pattern. Failures are reported to
 * `stream` and then rethrown, as an `AggregateError` when several steps failed.
 * @param {object} options
 * @param {Record<string, string | string[]>} options.config glob pattern to command or list
 * of commands
 * @param {string} [options.cwd] only staged files below this directory are processed
 * @param {boolean} [options.allowEmpty] allow a commit that is empty once the commands ran
 * @param {boolean} [options.bail] stop after the first failing command
 * @param {boolean} [options.parallel] run the patterns side by side (default) or one by one
 * @param {boolean} [options.restage] add the changes of the commands to the commit (default)
 * @param {boolean} [options.quiet] do not draw task progress
 * @param {NodeJS.WriteStream} [options.stream] where progress and errors go, stderr by default
 */
export async function runStaged({
  config,
  cwd = process.cwd(),
  allowEmpty = false,
  bail = false,
  parallel = true,
  restage = true,
  quiet = false,
  stream = process.stderr,
} = {}) {
  try {
    if (!config) {
      throw new Error(
        'No staged tasks configured. Add "staged" to the "pre-commit" hook in your nano-hooks configuration.',
      );
    }

    cwd = canonical(cwd);
    const gitPaths = await createGit(cwd).getGitPaths();
    if (!gitPaths.root) throw new Error("Not a git repository.");

    const files = await createGit(gitPaths.root).stagedFiles();
    if (!files.working.length) {
      log.info("No staged files found.", stream);
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
      parallel,
      restage,
    });
    if (!ran) log.info("No files match any configured task.", stream);
  } catch (error) {
    const causes = (error instanceof AggregateError ? error.errors : [error]).map(advise);
    for (const cause of causes) report(cause, stream);
    throw error instanceof AggregateError ? new AggregateError(causes, error.message) : causes[0];
  }
}

/**
 * Run the `staged` step of the `pre-commit` hook from the configuration. The settings come
 * from `flags` first, then the hook, then the `options` section.
 * @param {object} options
 * @param {Awaited<ReturnType<typeof loadConfig>>} options.loaded
 * @param {Record<string, unknown>} [options.flags] settings from the command line
 * @param {string} [options.cwd]
 * @returns {Promise<number>} the exit code
 */
export async function runConfiguredStaged({ loaded, flags = {}, cwd }) {
  const hook = hookParts(loaded.hooks[STAGED_HOOK]);
  const { allowEmpty, bail, parallel, restage } = { ...loaded.options, ...hook, ...flags };
  // Let rollback finish if the user interrupts a running commit.
  process.on("SIGINT", () => {});
  try {
    await runStaged({ config: hook.staged, cwd, allowEmpty, bail, parallel, restage });
  } catch {
    // runStaged has already reported the errors.
    return 1;
  }
  return 0;
}
