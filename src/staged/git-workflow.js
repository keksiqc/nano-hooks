// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
import fs from "fs";
import { resolve } from "path";

import { createGit } from "./git.js";

export function createGitWorkflow({ allowEmpty = false, dotPath = "", rootPath = "" } = {}) {
  const git = createGit(rootPath);
  const patch = {
    unstaged: resolve(dotPath, "./nano-staged_partial.patch"),
    original: resolve(dotPath, "./nano-staged.patch"),
  };

  const workflow = {
    hasPatch(path = "") {
      let has = false;

      if (path) {
        try {
          let buffer = fs.readFileSync(path);
          has = buffer && buffer.toString();
        } catch {
          has = false;
        }
      }

      return Boolean(has);
    },

    async backupOriginalState() {
      await git.diff(patch.original);
    },

    async backupUnstagedFiles(files = []) {
      if (files.length) {
        await git.diff(patch.unstaged, files);
        await git.checkout(files);
      }
    },

    async applyModifications(files = []) {
      if (files.length) {
        let hasDiff;
        try {
          hasDiff = await git.exec(["diff", "HEAD"]);
        } catch {
          hasDiff = await git.exec(["diff", "--cached"]);
        }

        if (!hasDiff && !allowEmpty) {
          throw "Prevented an empty git commit!";
        }

        await git.add(files);
      }
    },

    async restoreUnstagedFiles(files = []) {
      if (files.length) {
        try {
          await git.apply(patch.unstaged);
        } catch {
          try {
            await git.apply(patch.unstaged, true);
          } catch {
            throw "Merge conflict!!! Unstaged changes not restored.";
          }
        }
      }
    },

    async restoreOriginalState() {
      await git.checkout(".");

      if (workflow.hasPatch(patch.original)) {
        await git.apply(patch.original);
      }
    },

    async cleanUp() {
      if (workflow.hasPatch(patch.original)) {
        fs.unlinkSync(patch.original);
      }

      if (workflow.hasPatch(patch.unstaged)) {
        fs.unlinkSync(patch.unstaged);
      }
    },
  };

  return workflow;
}
