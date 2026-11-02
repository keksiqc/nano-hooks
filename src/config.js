import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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

const SECTIONS = new Set(["hooks", "staged", "preserveUnused"]);
const FILES = [".nano-hooks.js", ".nano-hooks.mjs", ".nano-hooks.json"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCommand = (value) => typeof value === "string" && value.trim() !== "";
const isTask = (value) =>
  isCommand(value) ||
  typeof value === "function" ||
  (Array.isArray(value) && value.length > 0 && value.every(isCommand));

async function read(path) {
  try {
    if (!/\.[cm]?js$/.test(path)) return JSON.parse(readFileSync(path, "utf8"));
    const mod = await import(pathToFileURL(path).href);
    return mod.default ?? mod;
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }
}

/** Read an explicitly named config file; a package.json holds it under the nano-hooks key. */
async function readFile(cwd, file) {
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new Error(`Configuration file ${file} not found.`);
  if (basename(path) !== "package.json") return { file, raw: await read(path) };

  const raw = (await read(path))["nano-hooks"];
  if (raw === undefined) throw new Error(`${file} has no "nano-hooks" key.`);
  return { file, raw };
}

/** Find the config in `cwd`: the dotfiles first, then the package.json key. */
async function find(cwd) {
  const name = FILES.find((file) => existsSync(join(cwd, file)));
  if (name) {
    return { file: name, raw: await read(join(cwd, name)) };
  }

  const pkg = join(cwd, "package.json");
  if (existsSync(pkg)) {
    const raw = (await read(pkg))["nano-hooks"];
    if (raw !== undefined) return { file: "package.json", raw };
  }
}

/** Collect every problem in the config, as lines naming the offending key. */
function validate(raw) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const key of Object.keys(raw)) {
    if (SECTIONS.has(key)) continue;
    problems.push(
      VALID_HOOKS.includes(key)
        ? `${key}: hooks go under "hooks" (hooks.${key})`
        : `${key}: unknown option (expected hooks, staged or preserveUnused)`,
    );
  }

  if ("hooks" in raw) {
    if (!isObject(raw.hooks)) {
      problems.push("hooks: must be an object of hook name to command");
    } else {
      for (const [name, command] of Object.entries(raw.hooks)) {
        if (!VALID_HOOKS.includes(name)) {
          problems.push(`hooks.${name}: unknown git hook`);
          unknownHook = true;
        } else if (!isCommand(command)) {
          problems.push(`hooks.${name}: must be a non-empty command string`);
        }
      }
    }
  }

  const keep = raw.preserveUnused;
  if (keep !== undefined && typeof keep !== "boolean") {
    if (!Array.isArray(keep)) {
      problems.push("preserveUnused: must be true, false or a list of hook names");
    } else {
      keep.forEach((name, i) => {
        if (VALID_HOOKS.includes(name)) return;
        problems.push(`preserveUnused[${i}]: unknown git hook "${name}"`);
        unknownHook = true;
      });
    }
  }

  if ("staged" in raw) {
    if (!isObject(raw.staged)) {
      problems.push("staged: must be an object of glob pattern to command(s)");
    } else if (Object.keys(raw.staged).length === 0) {
      problems.push("staged: must have at least one pattern");
    } else {
      for (const [pattern, task] of Object.entries(raw.staged)) {
        if (!isTask(task)) {
          problems.push(
            `staged["${pattern}"]: must be a command, a list of commands or a function`,
          );
        }
      }
    }
  }

  if (unknownHook) problems.push(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  return problems;
}

/**
 * Load the nano-hooks config from `cwd` (no upward search), or from `options.file`
 * (relative to `cwd`) when given. A missing config is an empty one; an invalid config,
 * or a named file that is missing, rejects.
 * @param {string} [cwd]
 * @param {{ file?: string }} [options]
 * @returns {Promise<{
 *   hooks: Record<string, string>,
 *   staged?: Record<string, string | string[] | Function>,
 *   preserveUnused: boolean | string[],
 * }>}
 */
export async function loadConfig(cwd = process.cwd(), { file } = {}) {
  const found = file ? await readFile(cwd, file) : await find(cwd);
  if (!found) return { hooks: {}, preserveUnused: false };

  const problems = validate(found.raw);
  if (problems.length) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${found.file}:`, ...lines].join("\n"));
  }

  const { hooks = {}, staged, preserveUnused = false } = found.raw;
  return { hooks, staged, preserveUnused };
}
