// The staged-file runner is based on nano-staged (MIT), see LICENSE.
import { realpathSync } from "node:fs";
import { loadConfig } from "../config.js";
import { createGitWorkflow } from "../backup.js";
import { createGit } from "../git.js";
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

  const errors = [];
  /** Run one step, show it, and record its error. @returns {Promise<boolean>} true if it worked */
  const step = async (title, run) => {
    const task = { title, state: "run" };
    renderer.start(task);
    try {
      await run(task);
      task.state = "done";
      return true;
    } catch (error) {
      task.state = "fail";
      errors.push(error);
      return false;
    }
  };

  // The backup is the safety net: without it nothing else runs.
  if (await step("Preparing nano-hooks", () => workflow.backupOriginalState())) {
    // Each step runs only if the steps before it worked. A failure restores the original state.
    let ok = true;
    if (modified.length) {
      ok = await step("Backing up unstaged changes for staged files", () =>
        workflow.backupUnstagedFiles(modified),
      );
    }
    ok =
      ok &&
      (await step("Running tasks for staged files", (task) => {
        task.tasks = groups;
        return runCommandGroups(task, groups, { bail, concurrent });
      }));
    ok =
      ok &&
      (await step("Applying modifications from tasks", () =>
        workflow.applyModifications(files.working),
      ));

    let cleanUp = true;
    if (!ok) {
      cleanUp = await step("Restoring to original state because of errors", () =>
        workflow.restoreOriginalState(),
      );
    } else if (modified.length) {
      await step("Restoring unstaged changes for staged files", () =>
        workflow.restoreUnstagedFiles(modified),
      );
    }
    if (cleanUp) await step("Cleaning up temporary patch files", () => workflow.cleanUp());
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
