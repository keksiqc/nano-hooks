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

const SECTIONS = ["hooks", "staged", "preserveUnused"];
const FILES = [".nano-hooks.js", ".nano-hooks.mjs", ".nano-hooks.json"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCommand = (value) => typeof value === "string" && value.trim() !== "";
const isTask = (value) =>
  isCommand(value) ||
  typeof value === "function" ||
  (Array.isArray(value) && value.length > 0 && value.every(isCommand));

async function read(path) {
  try {
    if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
    const mod = await import(pathToFileURL(path).href);
    return mod.default ?? mod;
  } catch (error) {
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }
}

/** Find the config in `cwd`: the dotfiles first, then the package.json key. */
async function find(cwd) {
  for (const name of FILES) {
    const path = join(cwd, name);
    if (existsSync(path)) return { file: name, raw: await read(path) };
  }

  const pkg = join(cwd, "package.json");
  if (existsSync(pkg)) {
    const raw = (await read(pkg))["nano-hooks"];
    if (raw !== undefined) return { file: "package.json", raw };
  }
}

/** Collect every problem in the config, as lines naming the offending key. */
function validate(raw) {
  if (!isObject(raw)) return ["config must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const key of Object.keys(raw)) {
    if (SECTIONS.includes(key)) continue;
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
 * Load the nano-hooks config from `cwd` (no upward search). A missing config is an
 * empty one; an invalid config rejects with every problem listed.
 * @param {string} [cwd]
 * @returns {Promise<{
 *   hooks: Record<string, string>,
 *   staged?: Record<string, string | string[] | Function>,
 *   preserveUnused: boolean | string[],
 * }>}
 */
export async function loadConfig(cwd = process.cwd()) {
  const found = await find(cwd);
  if (!found) return { hooks: {}, preserveUnused: false };

  const problems = validate(found.raw);
  if (problems.length) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks config in ${found.file}:`, ...lines].join("\n"));
  }

  const { hooks = {}, staged, preserveUnused = false } = found.raw;
  return { hooks, staged, preserveUnused };
}
