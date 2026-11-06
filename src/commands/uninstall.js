import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGit } from "../git.js";
import { managedHooks } from "../hooks.js";

/**
 * Remove every hook script that nano-hooks manages.
 * @param {{ cwd?: string }} [options]
 * @returns {Promise<{ removed: string[] }>}
 */
export async function uninstall({ cwd = process.cwd() } = {}) {
  const hooksDir = await createGit(resolve(cwd)).hooksDir();
  const removed = managedHooks(hooksDir);
  for (const name of removed) unlinkSync(join(hooksDir, name));
  return { removed };
}
