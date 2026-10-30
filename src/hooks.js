import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";

const MARKER = "# nano-hooks: managed file, do not edit";
const CLI_PATH = fileURLToPath(new URL("./cli.js", import.meta.url));

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

function resolveHooksDir(cwd) {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return resolve(cwd, out.trim());
  } catch (error) {
    if (/not a git repository/i.test(String(error.stderr))) {
      throw new Error(`Not a git repository: ${cwd}`, { cause: error });
    }
    throw error;
  }
}

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

/**
 * Write the configured hook scripts and drop stale managed ones.
 * @param {{ cwd?: string, config?: string }} [options] `config` is a nano-hooks config file
 * (relative to `cwd`) to use instead of discovering one.
 * @returns {Promise<{ installed: string[], removed: string[], skipped: string[] }>}
 */
export async function install({ cwd = process.cwd(), config } = {}) {
  const projectRoot = resolve(cwd);
  const hooksDir = resolveHooksDir(projectRoot);
  const {
    hooks: configured,
    staged,
    preserveUnused,
  } = await loadConfig(projectRoot, { file: config });
  const hooks = { ...configured };

  if (!hooks["pre-commit"] && staged) {
    const runtime = process.versions.bun ? "bun" : "node";
    // Git runs hooks from the repository root; the staged config may live in a sub-package.
    // Hooks run later, so a custom config has to be named explicitly in the command.
    const flag = config ? ` --config ${quote(resolve(projectRoot, config))}` : "";
    hooks["pre-commit"] = `cd ${quote(projectRoot)} && ${runtime} ${quote(CLI_PATH)} staged${flag}`;
  }

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
  const hooksDir = resolveHooksDir(resolve(cwd));
  const removed = managedHooks(hooksDir);
  for (const name of removed) unlinkSync(join(hooksDir, name));
  return { removed };
}
