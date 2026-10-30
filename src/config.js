import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Hook names from githooks(5). */
export const VALID_HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-receive",
  "update",
  "proc-receive",
  "post-receive",
  "post-update",
  "reference-transaction",
  "push-to-checkout",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
];

const FILES = [".nano-hooks.js", ".nano-hooks.mjs", ".nano-hooks.json"];

async function readRaw(cwd) {
  for (const name of FILES) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;
    if (name.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
    const mod = await import(pathToFileURL(path).href);
    return mod.default ?? mod;
  }

  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    return JSON.parse(readFileSync(pkgPath, "utf8"))["nano-hooks"];
  }
}

/**
 * Load the hooks config from `cwd` (no upward search).
 * @param {string} [cwd]
 * @returns {Promise<{ hooks: Record<string, string>, preserveUnused: boolean | string[] }>}
 */
export async function loadConfig(cwd = process.cwd()) {
  const { preserveUnused = false, ...hooks } = (await readRaw(cwd)) ?? {};

  for (const [name, command] of Object.entries(hooks)) {
    if (!VALID_HOOKS.includes(name)) {
      throw new Error(`nano-hooks: unknown git hook "${name}"`);
    }
    if (typeof command !== "string" || !command.trim()) {
      throw new Error(`nano-hooks: command for hook "${name}" must be a non-empty string`);
    }
  }

  return { hooks, preserveUnused };
}
