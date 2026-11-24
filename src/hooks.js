import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { toCommandList } from "./config.js";

export const MARKER = "# nano-hooks: managed file, do not edit";

/** Whether nano-hooks wrote the file. */
export function isManaged(path) {
  return readFileSync(path, "utf8").includes(MARKER);
}

/**
 * The shell code for a command or a list of commands. The first failure stops the list. Each
 * command but the last is in braces, so a `;` or `||` inside it cannot change where it stops.
 */
export function commandScript(command) {
  const lines = toCommandList(command);
  return lines
    .map((line, i) => (i === lines.length - 1 ? line : `{ ${line}\n} || exit $?`))
    .join("\n");
}

/** Every entry of the hooks directory, and whether nano-hooks wrote it. */
function scanHooksDir(hooksDir) {
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    managed: entry.isFile() && isManaged(join(hooksDir, entry.name)),
  }));
}

/** The names of the hook scripts that nano-hooks wrote. */
export function managedHooks(hooksDir) {
  return scanHooksDir(hooksDir)
    .filter((entry) => entry.managed)
    .map((entry) => entry.name);
}

/** Whether the directory holds anything that nano-hooks did not write. */
export function hasForeignFiles(hooksDir) {
  return scanHooksDir(hooksDir).some((entry) => !entry.managed);
}

/** Delete the named hook scripts from the hooks directory. */
export function removeHooks(hooksDir, names) {
  for (const name of names) unlinkSync(join(hooksDir, name));
}
