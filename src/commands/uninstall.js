import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createGit } from "../git.js";
import { managedHooks } from "../hooks.js";
import { log } from "../log.js";

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

/** @type {import("./index.js").Command} */
export const command = {
  name: "uninstall",
  description: "Remove the hooks nano-hooks manages",
  // Uninstall removes whatever nano-hooks wrote, so it reads no config. The --config option
  // is still accepted, so one set of options works for every command.
  async run() {
    const { removed } = await uninstall();
    for (const name of removed) log.success(`Removed *${name}*`);
    if (!removed.length) log.info("No nano-hooks hooks found.");
    return 0;
  },
};
