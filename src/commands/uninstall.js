import { resolve } from "node:path";

import { createGit } from "../git.js";
import { managedHooks, removeHooks } from "../hooks.js";

/** Remove every hook script that nano-hooks manages. */
export async function uninstall({ cwd = process.cwd() } = {}) {
  const hooksDir = await createGit(resolve(cwd)).hooksDir();
  const removed = managedHooks(hooksDir);
  removeHooks(hooksDir, removed);
  return { removed };
}
