import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createGit } from "./git.js";

const hasContent = (path) => existsSync(path) && statSync(path).size > 0;

/**
 * The git operations around running commands on staged files: back up the working state,
 * stash unstaged hunks of staged files, re-add the modifications and restore everything.
 * @param {{ allowEmpty?: boolean, dotPath: string, rootPath: string }} options
 */
export function createGitWorkflow({ allowEmpty = false, dotPath, rootPath }) {
  const git = createGit(rootPath);
  const original = join(dotPath, "nano-hooks.patch");
  const unstaged = join(dotPath, "nano-hooks_partial.patch");

  return {
    async backupOriginalState() {
      await git.diff(original);
    },

    async backupUnstagedFiles(files) {
      if (!files.length) return;
      await git.diff(unstaged, files);
      await git.checkout(files);
    },

    async applyModifications(files) {
      if (!files.length) return;

      // Before the first commit there is no HEAD to diff against.
      const diff = await git.exec(["diff", "HEAD"]).catch(() => git.exec(["diff", "--cached"]));
      if (!diff && !allowEmpty) throw new Error("Prevented an empty git commit!");

      await git.add(files);
    },

    async restoreUnstagedFiles(files) {
      if (!files.length) return;

      try {
        await git.apply(unstaged);
      } catch {
        try {
          await git.apply(unstaged, { threeWay: true });
        } catch {
          throw new Error("Merge conflict! Unstaged changes not restored.");
        }
      }
    },

    async restoreOriginalState() {
      await git.checkout(["."]);
      if (hasContent(original)) await git.apply(original);
    },

    cleanUp() {
      for (const patch of [original, unstaged]) {
        if (existsSync(patch)) unlinkSync(patch);
      }
    },
  };
}
