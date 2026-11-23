import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { createGit } from "./git.js";

const hasContent = (path) => existsSync(path) && statSync(path).size > 0;

/** Thrown when the tasks left nothing to commit. The command adds advice on how to allow it. */
export class EmptyCommitError extends Error {
  name = "EmptyCommitError";
}

/**
// A step is `{ title, state, tasks? }`. The workflow sets `state` (`run`, `done`, `fail`), and
// the observer only reads it. `tasks` are the progress nodes of the task execution.

/**
/**
 * Run `execute` on the staged files with the working tree protected: back up the unstaged
 * changes, run the tasks, add their changes to the index and restore the unstaged changes.
 * A failure rolls back to the original state.
 *
 * The recovery patches in `dotPath` stay, and the error lists them, when a rollback or a
 * restoration did not finish. A later run refuses to start while they exist.
 *
 * `files` is the result of `stagedFiles`. With `restage: false`, the changes of the tasks stay
 * in the working tree. `onStep` gets each step when it starts. Throws an `AggregateError` with
 * one error per failed step.
 */
export async function runWithBackup({
  allowEmpty = false,
  restage = true,
  dotPath,
  rootPath,
  files,
  execute,
  onStep = () => {},
}) {
  const original = join(dotPath, "nano-hooks.patch");
  const unstaged = join(dotPath, "nano-hooks_partial.patch");
  const patches = [original, unstaged];

  assertNoLeftovers(patches);

  const errors = [];
  const ctx = {
    git: createGit(rootPath),
    step: createStepRunner(onStep, errors),
    original,
    unstaged,
    modified: [...files.changed, ...files.deleted],
    files,
    execute,
    restage,
    allowEmpty,
  };

  if (!(await ctx.step("Preparing nano-hooks", () => ctx.git.diff(original)))) {
    try {
      removePatches(patches);
    } catch (error) {
      errors.push(error);
    }
    throw new AggregateError(errors, "Staged tasks failed");
  }

  const ok = await runTasks(ctx);
  const recovered = await recover(ok, ctx);

  if (recovered) {
    await ctx.step("Cleaning up temporary patch files", () => removePatches(patches));
  } else {
    const kept = patches.filter((patch) => existsSync(patch));
    if (kept.length > 0) errors.push(keptPatchesError(kept));
  }

  if (errors.length > 0) throw new AggregateError(errors, "Staged tasks failed");
}

function assertNoLeftovers(patches) {
  const leftovers = patches.filter((patch) => existsSync(patch));
  if (leftovers.length === 0) return;
  throw new Error(
    `nano-hooks found recovery patches from an earlier run that did not finish:\n${listPaths(leftovers)}\nUse them to recover your changes, then delete them. nano-hooks did not change your repository.`,
  );
}

const keptPatchesError = (kept) =>
  new Error(
    `nano-hooks kept these recovery patches so that you can recover your changes:\n${listPaths(kept)}\nDelete them when you are done. nano-hooks does not run while they exist.`,
  );

/** Run one step: report it to the observer, set its state and collect its error. */
function createStepRunner(onStep, errors) {
  return async (title, run, tasks) => {
    const node = { title, state: "run" };
    if (tasks) node.tasks = tasks;
    try {
      onStep(node);
    } catch {}
    try {
      await run(node);
      node.state = "done";
      return true;
    } catch (error) {
      node.state = "fail";
      errors.push(error);
      return false;
    }
  };
}

function removePatches(patches) {
  const failures = [];
  for (const patch of patches) {
    try {
      if (existsSync(patch)) unlinkSync(patch);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      failures.map((error) => `Could not delete ${error.path}: ${error.code}`).join("\n"),
    );
  }
}

/** Back up the unstaged changes, run the tasks and stage their changes. True when all passed. */
async function runTasks({ git, step, unstaged, modified, files, execute, restage, allowEmpty }) {
  let ok = true;
  if (modified.length > 0) {
    ok = await step("Backing up unstaged changes for staged files", async () => {
      await git.diff(unstaged, modified);
      await git.checkout(modified);
    });
  }
  ok = ok && (await step("Running tasks for staged files", () => execute.run(), execute.tasks));
  return (
    ok &&
    (!restage ||
      (await step("Applying modifications from tasks", async () => {
        if (!allowEmpty && !(await git.wouldChange(files.working))) {
          throw new EmptyCommitError("The commit would be empty.");
        }
        await git.add(files.working);
      })))
  );
}

async function restoreUnstaged(git, unstaged) {
  try {
    await git.apply(unstaged);
  } catch {
    try {
      await git.apply(unstaged, { threeWay: true });
    } catch {
      throw new Error(
        "A merge conflict occurred, so nano-hooks did not restore your unstaged changes.",
      );
    }
  }
}

/** Roll back after a failure, or restore the unstaged changes. True when that worked. */
function recover(ok, { git, step, original, unstaged, modified }) {
  if (!ok) {
    return step("Restoring to original state because of errors", async () => {
      await git.checkout(["."]);
      if (hasContent(original)) await git.apply(original);
    });
  }
  if (modified.length > 0) {
    return step("Restoring unstaged changes for staged files", () =>
      restoreUnstaged(git, unstaged),
    );
  }
  return true;
}

const listPaths = (paths) => paths.map((path) => `  ${path}`).join("\n");
