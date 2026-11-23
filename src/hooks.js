import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { loadConfig } from "./config.js";
import { createGit } from "./git.js";

export const MARKER = "# nano-hooks: managed file, do not edit";

export const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

export function isManaged(path) {
  return readFileSync(path, "utf8").includes(MARKER);
}

/**
/**
 * The shell code for a command or a list of commands. The first failure stops the list. Each
 * command but the last is in braces, so a `;` or `||` inside it cannot change where it stops.
 */
export function commandScript(command) {
  if (!Array.isArray(command)) return command;
  return command
    .map((line, i) => (i === command.length - 1 ? line : `{ ${line}\n} || exit $?`))
    .join("\n");
}

/** Whether the directory holds anything that nano-hooks did not write. */
export function hasForeignFiles(hooksDir) {
  if (!existsSync(hooksDir)) return false;
  return readdirSync(hooksDir, { withFileTypes: true }).some(
    (entry) => !entry.isFile() || !isManaged(join(hooksDir, entry.name)),
  );
}

export function managedHooks(hooksDir) {
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isManaged(join(hooksDir, entry.name)))
    .map((entry) => entry.name);
}

/**
/**
 * The project directory relative to the working tree root, with forward slashes, or "".
 * Hooks use it instead of absolute paths, so they keep working when the repository moves.
 */
async function relativeRoot(projectRoot) {
  try {
    const top = await createGit(projectRoot).toplevel();
    // The native version also expands Windows short names such as RUNNER~1, which git does
    // not report, so both paths have the same form.
    return relative(realpathSync.native(top), realpathSync.native(projectRoot)).replaceAll(
      "\\",
      "/",
    );
  } catch {
    return "";
  }
}

function hookScript(binDir, script) {
  return [
    "#!/bin/sh",
    MARKER,
    'if [ "${SKIP_NANO_HOOKS:-}" = "1" ]; then',
    "  exit 0",
    "fi",
    `PATH="$PWD"/${quote(binDir)}:"$PATH"`,
    script,
    "",
  ].join("\n");
}

/**
/**
 * Write the configured hook scripts and drop stale managed ones. `config` is a config file,
 * relative to `cwd`, to use instead of discovering one. `external` in the result is true when
 * `hooksDir` is outside the git directory because `core.hooksPath` points there, as husky does.
 */
export async function install({ cwd = process.cwd(), config } = {}) {
  const projectRoot = resolve(cwd);
  const { dir: hooksDir, external } = await createGit(projectRoot).hooksInfo();
  const loaded = await loadConfig(projectRoot, { file: config });
  const { preserveUnused } = loaded;
  const rel = await relativeRoot(projectRoot);
  const { hooks } = loaded;
  const binDir = join(rel, "node_modules", ".bin").replaceAll("\\", "/");

  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const [name, value] of Object.entries(hooks)) {
    const path = join(hooksDir, name);
    if (existsSync(path) && !isManaged(path)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(path, hookScript(binDir, commandScript(value)), {
      mode: 0o755,
    });
    chmodSync(path, 0o755);
    installed.push(name);
  }

  const keep = (name) =>
    name in hooks ||
    preserveUnused === true ||
    (Array.isArray(preserveUnused) && preserveUnused.includes(name));
  const removed = managedHooks(hooksDir).filter((name) => !keep(name));
  for (const name of removed) unlinkSync(join(hooksDir, name));

  return { installed, removed, skipped, hooksDir, external };
}
