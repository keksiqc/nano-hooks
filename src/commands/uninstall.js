import { resolve } from "node:path";

import { createGit } from "../git.js";
import { managedHooks, removeHooks } from "../hooks.js";
import { log } from "../log.js";

export const uninstallCommand = {
  name: "uninstall",
  description: "Remove the hooks nano-hooks manages",
  async run() {
    const { removed } = await uninstall();
    for (const name of removed) log.success(`Removed ${name}`);
    if (removed.length === 0) log.info("No nano-hooks hooks found.");
    return 0;
  },
};

/** Remove every hook script that nano-hooks manages. */
export async function uninstall({ cwd = process.cwd() } = {}) {
  const hooksDir = await createGit(resolve(cwd)).hooksDir();
  const removed = managedHooks(hooksDir);
  removeHooks(hooksDir, removed);
  return { removed };
}
