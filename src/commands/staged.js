import { EmptyCommitError, runWithBackup } from "../backup.js";
import { createGit } from "../git.js";
import { createRenderer, log } from "../log.js";
import { realPath } from "../paths.js";
import { resolveSettings } from "../settings.js";
import { CommandError, createCommandGroups, runCommandGroups } from "../tasks.js";

/**
 * Run the commands of `config` on the matching staged `files`, inside a backup of the index and
 * the unstaged changes. Returns false when no file matches a pattern.
 */
async function runStagedTasks({ config, files, gitPaths, cwd, stream, quiet, settings }) {
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
      allowEmpty: settings.allowEmpty,
      restage: settings.restage,
      rootPath: gitPaths.root,
      gitDir: gitPaths.gitDir,
      files,
      execute: {
        tasks: groups,
        run: () => runCommandGroups(groups, { bail: settings.bail, parallel: settings.parallel }),
      },
      onStep: (step) => renderer.start(step),
    });
  } finally {
    renderer.stop();
  }
  return true;
}

function advise(error) {
  return error instanceof EmptyCommitError
    ? new Error(`${error.message} Use --allow-empty to allow it.`, { cause: error })
    : error;
}

function report(error, stream) {
  if (error instanceof CommandError) log.failures(error.failures, stream);
  else log.error(error?.message ?? String(error), stream);
}

/**
 * Run the commands of `config` (glob pattern to command or list of commands) on the staged
 * files below `cwd`. Failures go to `stream` and are rethrown, as an `AggregateError` when
 * several steps failed. `allowEmpty`, `bail`, `parallel` and `restage` are the settings of
 * `staged`, and `quiet` hides the progress.
 */
export async function runStaged({
  config,
  cwd = process.cwd(),
  quiet = false,
  stream = process.stderr,
  ...settings
} = {}) {
  try {
    if (!config) {
      throw new Error(
        'No staged tasks configured. Add a "staged" key to your nano-hooks configuration.',
      );
    }

    cwd = realPath(cwd);
    const gitPaths = await createGit(cwd).getGitPaths();
    if (!gitPaths.root) throw new Error("Not a git repository.");

    const files = await createGit(gitPaths.root).stagedFiles();
    if (files.working.length === 0) {
      log.info("No staged files found.", stream);
      return;
    }

    const ran = await runStagedTasks({
      config,
      files,
      gitPaths,
      cwd,
      stream,
      quiet,
      settings: resolveSettings(settings),
    });
    if (!ran) log.info("No files match any configured task.", stream);
  } catch (error) {
    const causes = (error instanceof AggregateError ? error.errors : [error]).map((cause) =>
      advise(cause),
    );
    for (const cause of causes) report(cause, stream);
    throw error instanceof AggregateError ? new AggregateError(causes, error.message) : causes[0];
  }
}

/**
 * Run the commands of the top-level `staged` key. A setting comes from `flags`, then
 * `options`. Returns the exit code.
 */
export async function runConfiguredStaged({ loaded, flags = {}, cwd }) {
  const settings = resolveSettings(loaded.options, flags);
  process.on("SIGINT", () => {});
  try {
    await runStaged({ config: loaded.staged, cwd, ...settings });
  } catch {
    return 1;
  }
  return 0;
}
