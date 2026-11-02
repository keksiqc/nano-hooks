import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { VALID_HOOKS, loadConfig } from "./config.js";
import { createGit } from "./git.js";

const MARKER = "# nano-hooks: managed file, do not edit";
const CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function isManaged(path) {
  return readFileSync(path, "utf8").includes(MARKER);
}

function script(projectRoot, command) {
  return [
    "#!/bin/sh",
    MARKER,
    'if [ "${SKIP_NANO_HOOKS:-}" = "1" ]; then',
    "  exit 0",
    "fi",
    `PATH=${quote(join(projectRoot, "node_modules", ".bin"))}:"$PATH"`,
    command,
    "",
  ].join("\n");
}

function managedHooks(hooksDir) {
  if (!existsSync(hooksDir)) return [];
  return readdirSync(hooksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isManaged(join(hooksDir, entry.name)))
    .map((entry) => entry.name);
}

/** The configured hook commands, plus the default `pre-commit` that runs `staged`. */
function withDefaults(projectRoot, { hooks: configured, staged }, config) {
  const hooks = { ...configured };

  if (!hooks["pre-commit"] && staged) {
    const runtime = process.versions.bun ? "bun" : "node";
    // Git runs hooks from the repository root; the staged config may live in a sub-package.
    // Hooks run later, so a custom config has to be named explicitly in the command.
    const flag = config ? ` --config ${quote(resolve(projectRoot, config))}` : "";
    hooks["pre-commit"] = `cd ${quote(projectRoot)} && ${runtime} ${quote(CLI_PATH)} staged${flag}`;
  }
  return hooks;
}

/**
 * Write the configured hook scripts and drop stale managed ones.
 * @param {{ cwd?: string, config?: string }} [options] `config` is a nano-hooks config file
 * (relative to `cwd`) to use instead of discovering one.
 * @returns {Promise<{ installed: string[], removed: string[], skipped: string[] }>}
 */
export async function install({ cwd = process.cwd(), config } = {}) {
  const projectRoot = resolve(cwd);
  const hooksDir = await createGit(projectRoot).hooksDir();
  const loaded = await loadConfig(projectRoot, { file: config });
  const { preserveUnused } = loaded;
  const hooks = withDefaults(projectRoot, loaded, config);

  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const [name, command] of Object.entries(hooks)) {
    const path = join(hooksDir, name);
    if (existsSync(path) && !isManaged(path)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(path, script(projectRoot, command), { mode: 0o755 });
    chmodSync(path, 0o755);
    installed.push(name);
  }

  const keep = (name) =>
    name in hooks ||
    preserveUnused === true ||
    (Array.isArray(preserveUnused) && preserveUnused.includes(name));
  const removed = managedHooks(hooksDir).filter((name) => !keep(name));
  for (const name of removed) unlinkSync(join(hooksDir, name));

  return { installed, removed, skipped };
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
  const command = withDefaults(projectRoot, loaded, config)[name];
  if (!command) throw new Error(`No command configured for hook "${name}".`);

  const bin = join(projectRoot, "node_modules", ".bin");
  const env = { ...process.env, PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter) };

  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", command, name, ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}
