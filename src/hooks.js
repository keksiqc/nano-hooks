import { spawn } from "node:child_process";
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
import { delimiter, join, relative, resolve } from "node:path";
import { VALID_HOOKS, loadConfig } from "./config.js";
import { createGit } from "./git.js";

const MARKER = "# nano-hooks: managed file, do not edit";

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function isManaged(path) {
  return readFileSync(path, "utf8").includes(MARKER);
}

/**
 * The project directory as a path relative to the working tree root, with forward slashes,
 * or "" when they are the same. Git runs hooks from the working tree root, so the scripts
 * can use this instead of absolute paths and keep working when the repository moves.
 */
async function relativeRoot(projectRoot) {
  try {
    const top = await createGit(projectRoot).toplevel();
    return relative(realpathSync(top), realpathSync(projectRoot)).replaceAll("\\", "/");
  } catch {
    return "";
  }
}

/**
 * The shell code for a hook command, or for a list of commands that run one after the
 * other. The first command that fails stops the list and its exit code is the result.
 * Each command but the last is in braces, so that `;` or `||` inside it cannot change
 * where the list stops.
 */
function commandScript(command) {
  if (!Array.isArray(command)) return command;
  return command
    .map((line, i) => (i === command.length - 1 ? line : `{ ${line}\n} || exit $?`))
    .join("\n");
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

function managedHooks(hooksDir) {
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
function withDefaults({ hooks: configured, staged }, config, cd = "") {
  const hooks = { ...configured };

  if (!hooks["pre-commit"] && staged) {
    const flag = config ? ` --config ${quote(config)}` : "";
    hooks["pre-commit"] = `${cd}nano-hooks staged${flag}`;
  }
  return hooks;
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

/**
 * Run the configured command of one hook now, as git would. The command runs in a `sh`
 * shell with the output shown as it happens, and `args` become its `$1`, `$2`, and so on.
 * Unlike an installed hook, it ignores `SKIP_NANO_HOOKS`.
 * @param {string} name a git hook name, such as `pre-commit`
 * @param {string[]} [args] arguments git would pass to that hook
 * @param {{ cwd?: string, config?: string }} [options]
 * @returns {Promise<number>} the exit code of the command
 */
export async function runHook(name, args = [], { cwd = process.cwd(), config } = {}) {
  if (!VALID_HOOKS.includes(name)) {
    throw new Error(`Unknown git hook "${name}". Valid hooks: ${VALID_HOOKS.join(", ")}`);
  }

  const projectRoot = resolve(cwd);
  const loaded = await loadConfig(projectRoot, { file: config });
  const command = withDefaults(loaded, config)[name];
  if (!command) throw new Error(`No command configured for hook "${name}".`);

  const bin = join(projectRoot, "node_modules", ".bin");
  const env = { ...process.env, PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter) };

  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", commandScript(command), name, ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}
