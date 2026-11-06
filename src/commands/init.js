import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findConfig, readFailure } from "../config.js";

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

/** The package manager of a project: the `packageManager` field first, then the lockfile. */
function detectPackageManager(cwd, manifest) {
  const declared = /^(pnpm|yarn|bun|npm)@/.exec(manifest.packageManager ?? "");
  if (declared) return declared[1];
  return LOCKFILES.find(([file]) => existsSync(join(cwd, file)))?.[1] ?? "npm";
}

/**
 * Add a starter nano-hooks configuration to the `package.json` of `cwd`: a `pre-commit`
 * hook that runs `command`, and a `prepare` script that installs the hooks. An existing
 * configuration is never changed.
 * @param {{ cwd?: string, command?: string }} [options] `command` defaults to the `lint`
 * script of the package manager of the project, such as `pnpm run lint`.
 * @returns {Promise<{ command: string, prepare: "added" | "appended" | "kept" }>}
 */
export async function init({ cwd = process.cwd(), command } = {}) {
  const projectRoot = resolve(cwd);
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) throw new Error(`No package.json found in ${projectRoot}.`);

  const existing = findConfig(projectRoot);
  if (existing) {
    throw new Error(`nano-hooks is already configured in ${existing.file}. Nothing changed.`);
  }

  const text = readFileSync(path, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw readFailure(path, error);
  }

  const hook = command?.trim() || `${detectPackageManager(projectRoot, manifest)} run lint`;
  const scripts = { ...manifest.scripts };
  let prepare = "kept";
  if (!scripts.prepare) {
    scripts.prepare = "nano-hooks";
    prepare = "added";
  } else if (!/\bnano-hooks\b/.test(scripts.prepare)) {
    scripts.prepare = `${scripts.prepare} && nano-hooks`;
    prepare = "appended";
  }

  const updated = { ...manifest, scripts, "nano-hooks": { "pre-commit": hook } };
  // Keep the indentation and the final newline of the file.
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? 2;
  writeFileSync(path, `${JSON.stringify(updated, null, indent)}${text.endsWith("\n") ? "\n" : ""}`);

  return { command: hook, prepare };
}
