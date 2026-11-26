import { resolve } from "node:path";

import { createGit } from "../lib/git.js";
import { removeManagedHooks } from "../lib/hooks.js";
import { log } from "../lib/log.js";

export function registerUninstallCommand(cli) {
  return cli.command("uninstall", "Remove the hooks nano-hooks manages").action(async () => {
    const { removed } = await uninstall();
    for (const name of removed) log.success(`Removed ${name}`);
    if (removed.length === 0) log.info("No nano-hooks hooks found.");
    return 0;
  });
}

/** Remove every hook script that nano-hooks manages. */
export async function uninstall({ cwd = process.cwd() } = {}) {
  const hooksDir = await createGit(resolve(cwd)).hooksDir();
  const { removed } = removeManagedHooks(hooksDir);
  return { removed };
}
