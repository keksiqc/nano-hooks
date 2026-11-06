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
import { hookParts, loadConfig } from "./config.js";
import { NotGitRepositoryError, createGit } from "./git.js";
import { log } from "./log.js";

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
 * The commands that add a step to a hook, such as `staged` for `pre-commit`. A command adds
 * its step when the hook in the configuration has the key of that command. The command
 * list loads on first use, because the commands import this module.
 * @param {string} name a git hook name
 * @param {unknown} value the value of the hook in the configuration
 * @returns {Promise<import("./commands/index.js").Command[]>}
 */
export async function hookSteps(name, value) {
  const { commands } = await import("./commands/index.js");
  const parts = hookParts(value);
  return commands.filter(
    (command) => command.hook === name && parts[command.section.name] !== undefined,
  );
}

/**
 * The shell code of an installed hook: one call of `nano-hooks` for each step of the hook,
 * such as `nano-hooks staged`, and then the `run` commands as they are written. The first
 * one that fails stops the hook. `cd` is a prefix for the calls of `nano-hooks`, for hooks
 * that start in another directory, and `config` is the configuration file of the project,
 * if it is not discovered. A call runs in a subshell, so that `cd` does not change where
 * the `run` commands start.
 * @param {string} name
 * @param {unknown} value
 * @param {string} [config]
 * @param {string} [cd]
 */
async function hookCommand(name, value, config, cd) {
  const flag = config ? ` --config ${quote(config)}` : "";
  // The `nano-hooks` command comes from `node_modules/.bin`, which the script puts on PATH.
  const steps = (await hookSteps(name, value)).map((step) => {
    const call = `${cd}nano-hooks ${step.name}${flag}`;
    return cd ? `(${call})` : call;
  });
  const { run = [] } = hookParts(value);
  return commandScript([...steps, ...[run].flat()]);
}

/**
 * The project directory as a path relative to the working tree root, with forward slashes,
 * or "" when they are the same. Git runs hooks from the working tree root, so the scripts
 * can use this instead of absolute paths and keep working when the repository moves.
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
 * Write the configured hook scripts and drop stale managed ones.
 * @param {{ cwd?: string, config?: string }} [options] `config` is a nano-hooks config file
 * (relative to `cwd`) to use instead of discovering one.
 * @returns {Promise<{ installed: string[], removed: string[], skipped: string[], hooksDir: string, external: boolean }>}
 * `external` is true when `hooksDir` is outside the git directory because `core.hooksPath`
 * points there, so another tool such as husky can manage the same directory.
 */
export async function install({ cwd = process.cwd(), config } = {}) {
  const projectRoot = resolve(cwd);
  const { dir: hooksDir, external } = await createGit(projectRoot).hooksInfo();
  const loaded = await loadConfig(projectRoot, { file: config });
  const { preserveUnused } = loaded;
  const rel = await relativeRoot(projectRoot);
  const { hooks } = loaded;
  const cd = rel ? `cd ${quote(rel)} && ` : "";
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
    writeFileSync(path, hookScript(binDir, await hookCommand(name, value, config, cd)), {
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

/** Write the hooks and report what happened. @returns {Promise<number>} the exit code */
export async function installHooks(config) {
  // Lets CI and container builds run `prepare` without installing hooks.
  if (process.env.NANO_HOOKS === "0") {
    log.info("Skipped install because NANO_HOOKS=0.");
    return 0;
  }

  let result;
  try {
    result = await install({ config });
  } catch (error) {
    if (!(error instanceof NotGitRepositoryError)) throw error;
    // A `prepare` script must not fail an install where there is no .git directory.
    log.warn(`${error.message}. Hooks were not installed.`, { markup: false });
    return 0;
  }
  const { installed, removed, skipped, hooksDir, external } = result;
  if (external && hasForeignFiles(hooksDir)) {
    log.warn(
      `core.hooksPath points outside .git: ${hooksDir}. Another hooks manager, such as husky, can use the same directory.`,
      { markup: false },
    );
  }
  for (const name of installed) log.success(`Installed *${name}*`);
  for (const name of removed) log.success(`Removed *${name}* (no longer configured)`);
  for (const name of skipped) {
    log.warn(`Skipped *${name}* because nano-hooks did not write the existing hook`);
  }
  if (!installed.length && !removed.length && !skipped.length) {
    log.info("No hooks to install.");
  }
  return 0;
}
