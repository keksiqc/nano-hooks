import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MARKER = "# nano-hooks: managed file, do not edit";

export const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

export function isManaged(path) {
  return readFileSync(path, "utf8").includes(MARKER);
}

/**
 * The shell code for a hook command, or for a list of commands that run one after the
 * other. The first command that fails stops the list and its exit code is the result.
 * Each command but the last is in braces, so that `;` or `||` inside it cannot change
 * where the list stops.
 */
export function commandScript(command) {
  if (!Array.isArray(command)) return command;
  return command
    .map((line, i) => (i === command.length - 1 ? line : `{ ${line}\n} || exit $?`))
    .join("\n");
}

export function managedHooks(hooksDir) {
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isManaged(join(hooksDir, entry.name)))
    .map((entry) => entry.name);
}
