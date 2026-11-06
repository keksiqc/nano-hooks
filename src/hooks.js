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

/**
 * The configured hook commands, plus the default `pre-commit` that runs `staged`.
 * `cd` is a prefix for that default command, for hooks that start in another directory.
 * The `nano-hooks` command comes from `node_modules/.bin`, which the hook puts on PATH.
 * The staged config may live in a sub-package, and a custom config has to be named
 * explicitly because hooks run later, from another directory.
 */
export function withDefaults({ hooks: configured, staged }, config, cd = "") {
  const hooks = { ...configured };

  if (!hooks["pre-commit"] && staged) {
    const flag = config ? ` --config ${quote(config)}` : "";
    hooks["pre-commit"] = `${cd}nano-hooks staged${flag}`;
  }
  return hooks;
}
