import { chmodSync, existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../config.js";
import { NotGitRepositoryError, createGit } from "../git.js";
import { MARKER, commandScript, isManaged, managedHooks, quote, withDefaults } from "../hooks.js";
import { log } from "../log.js";

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

function script(binDir, command) {
  return [
    "#!/bin/sh",
    MARKER,
    'if [ "${SKIP_NANO_HOOKS:-}" = "1" ]; then',
    "  exit 0",
    "fi",
    `PATH="$PWD"/${quote(binDir)}:"$PATH"`,
    commandScript(command),
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
  const hooks = withDefaults(loaded, config, rel ? `cd ${quote(rel)} && ` : "");
  const binDir = join(rel, "node_modules", ".bin").replaceAll("\\", "/");

  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const [name, command] of Object.entries(hooks)) {
    const path = join(hooksDir, name);
    if (existsSync(path) && !isManaged(path)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(path, script(binDir, command), { mode: 0o755 });
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
  if (external) {
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

/** @type {import("./index.js").Command} */
export const command = {
  name: "install",
  default: true,
  description: "Write the configured git hooks",
  run: ({ options }) => installHooks(options.config),
};
