// The staged-file runner is based on nano-staged (MIT), see LICENSE.
import { realpathSync } from "node:fs";
import { createGitWorkflow } from "./backup.js";
import { createGit } from "./git.js";
import { log } from "./log.js";
import { createRenderer } from "./renderer.js";
import { CommandError, createCommandGroups, runCommandGroups } from "./tasks.js";

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
  const workflow = createGitWorkflow({
    allowEmpty,
    rootPath: gitPaths.root,
    dotPath: gitPaths.dot,
  });
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
  const modified = [...files.changed, ...files.deleted];

  // The backup is the safety net: without it nothing else runs.
  let backupFailed = false;
  let rollback = false;
  let cleanUp = true;

  const steps = [
    {
      title: "Preparing nano-hooks",
      run: async () => {
        try {
          await workflow.backupOriginalState();
        } catch (error) {
          backupFailed = true;
          throw error;
        }
      },
    },
    {
      title: "Backing up unstaged changes for staged files",
      skip: () => backupFailed || modified.length === 0,
      run: async () => {
        try {
          await workflow.backupUnstagedFiles(modified);
        } catch (error) {
          rollback = true;
          throw error;
        }
      },
    },
    {
      title: "Running tasks for staged files",
      skip: () => backupFailed || rollback,
      run: async (task) => {
        task.tasks = groups;
        try {
          await runCommandGroups(task, groups, { bail, concurrent });
        } catch (error) {
          rollback = true;
          throw error;
        }
      },
    },
    {
      title: "Applying modifications from tasks",
      skip: () => backupFailed || rollback,
      run: async () => {
        try {
          await workflow.applyModifications(files.working);
        } catch (error) {
          rollback = true;
          throw error;
        }
      },
    },
    {
      title: "Restoring unstaged changes for staged files",
      skip: () => backupFailed || rollback || modified.length === 0,
      run: () => workflow.restoreUnstagedFiles(modified),
    },
    {
      title: "Restoring to original state because of errors",
      skip: () => backupFailed || !rollback,
      run: async () => {
        try {
          await workflow.restoreOriginalState();
        } catch (error) {
          cleanUp = false;
          throw error;
        }
      },
    },
    {
      title: "Cleaning up temporary patch files",
      skip: () => backupFailed || !cleanUp,
      run: () => workflow.cleanUp(),
    },
  ];

  const errors = [];
  for (const step of steps) {
    if (step.skip?.()) continue;

    renderer.start(step);
    step.state = "run";
    try {
      await step.run(step);
      step.state = "done";
    } catch (error) {
      step.state = "fail";
      errors.push(error);
    }
  }
  renderer.stop();

  if (errors.length) throw new AggregateError(errors, "Staged tasks failed");
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

/** Command output is already formatted; anything else is a plain error line. */
function report(error, stream) {
  if (error instanceof CommandError) stream.write(`\n${error.message}\n`);
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
    for (const cause of error instanceof AggregateError ? error.errors : [error]) {
      report(cause, stream);
    }
    throw error;
  }
}
