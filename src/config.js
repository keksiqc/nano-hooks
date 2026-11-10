import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { globToRegex } from "./glob.js";

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
  "reference-transaction",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "post-index-change",
];

/** The hook that has the `staged` step. */
export const STAGED_HOOK = "pre-commit";

/** The true or false settings of the `staged` step. Each one is a flag of `nano-hooks staged`. */
export const SETTINGS = ["allowEmpty", "bail", "parallel", "restage"];

const OPTIONS = [...SETTINGS, "preserveUnused"];

/** The JSON files to search for, after the `nano-hooks` key of `package.json`. */
const FILES = ["nano-hooks.config.json", ".nano-hooks.json"];

export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isCommand = (value) => typeof value === "string" && value.trim() !== "";
/** A command, or a non-empty list of commands. */
export const isCommandList = (value) =>
  isCommand(value) || (Array.isArray(value) && value.length > 0 && value.every(isCommand));

/**
 * The parts of a hook value. A command or a list of commands is the same as an object with
 * only `run`.
 * @param {unknown} value the value of a hook in the configuration
 * @returns {{ run?: string | string[] } & Record<string, unknown>}
 */
export function hookParts(value) {
  if (value === undefined) return {};
  return isObject(value) ? value : { run: value };
}

/** Whether a hook has the `staged` step, which only the `pre-commit` hook can have. */
export const hasStaged = (name, value) =>
  name === STAGED_HOOK && hookParts(value).staged !== undefined;

/** The error for a file that cannot be read or parsed. */
export const readFailure = (path, error) =>
  new Error(`Failed to read ${path}: ${error.message}`, { cause: error });

function read(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw readFailure(path, error);
  }
}

/** Read an explicitly named config file; a package.json holds it under the nano-hooks key. */
function readFile(cwd, file) {
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new Error(`Configuration file ${file} not found.`);
  if (extname(path).toLowerCase() !== ".json") {
    throw new Error(`${file}: nano-hooks reads only JSON configuration files.`);
  }
  if (basename(path) !== "package.json") return { file, raw: read(path) };

  const raw = read(path)["nano-hooks"];
  if (raw === undefined) throw new Error(`${file} has no "nano-hooks" key.`);
  return { file, raw };
}

/**
 * Find the config in `cwd`: the `nano-hooks` key of `package.json` or one of the files in
 * `FILES`. More than one of them is an error, because the project then has two
 * configurations and only one can be right.
 */
export function findConfig(cwd) {
  const found = [];
  const pkg = join(cwd, "package.json");
  if (existsSync(pkg)) {
    const raw = read(pkg)["nano-hooks"];
    if (raw !== undefined) found.push({ file: "package.json", raw });
  }
  for (const file of FILES) {
    if (existsSync(join(cwd, file))) found.push({ file, raw: read(join(cwd, file)) });
  }

  if (found.length > 1) {
    const names = found.map(({ file }) => file).join(", ");
    throw new Error(
      `Found more than one nano-hooks configuration: ${names}. Keep one and delete the others.`,
    );
  }
  return found[0];
}

const NO_COMMAND = "must be a command or a non-empty list of commands";

/** The problems in the `staged` key of a hook, as lines naming the key. */
function validateStaged(staged, path) {
  if (!isObject(staged)) return [`${path}: must be an object of glob pattern to command(s)`];
  if (Object.keys(staged).length === 0) return [`${path}: must have at least one pattern`];
  const problems = [];
  for (const [pattern, task] of Object.entries(staged)) {
    if (!isCommandList(task)) problems.push(`${path}["${pattern}"]: ${NO_COMMAND}`);
    try {
      globToRegex(pattern);
    } catch (error) {
      problems.push(`${path}["${pattern}"]: ${error.message}`);
    }
  }
  return problems;
}

/** The problems in one hook, as lines naming the key. */
function validateHook(name, value) {
  if (isCommandList(value)) return [];
  if (!isObject(value)) return [`${name}: must be a command, a list of commands or an object`];

  const staged = name === STAGED_HOOK;
  const allowed = staged ? ["run", "staged", ...SETTINGS] : ["run"];
  const problems = [];

  for (const [key, entry] of Object.entries(value)) {
    const path = `${name}.${key}`;
    if (key === "run") {
      if (!isCommandList(entry)) problems.push(`${path}: ${NO_COMMAND}`);
    } else if (staged && key === "staged") {
      problems.push(...validateStaged(entry, path));
    } else if (staged && SETTINGS.includes(key)) {
      if (typeof entry !== "boolean") problems.push(`${path}: must be true or false`);
    } else if (key === "staged" || SETTINGS.includes(key)) {
      problems.push(`${path}: only the "${STAGED_HOOK}" hook accepts this key`);
    } else {
      problems.push(`${path}: unknown key (expected ${allowed.join(", ")})`);
    }
  }

  if (!("run" in value) && !(staged && "staged" in value)) {
    problems.push(`${name}: needs ${staged ? '"run" or "staged"' : '"run"'}`);
  }
  return problems;
}

/** Collect every problem in the config, as lines naming the offending key. */
function validate(raw) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "options") continue;
    if (VALID_HOOKS.includes(key)) {
      problems.push(...validateHook(key, value));
    } else {
      problems.push(`${key}: unknown key (expected a git hook name or options)`);
      unknownHook = true;
    }
  }

  if ("options" in raw) {
    if (!isObject(raw.options)) {
      problems.push("options: must be an object");
    } else {
      for (const [name, value] of Object.entries(raw.options)) {
        if (!OPTIONS.includes(name)) {
          problems.push(`options.${name}: unknown option (expected ${OPTIONS.join(", ")})`);
        } else if (name === "preserveUnused") {
          if (typeof value === "boolean") continue;
          if (!Array.isArray(value)) {
            problems.push("options.preserveUnused: must be true, false or a list of hook names");
            continue;
          }
          value.forEach((hook, i) => {
            if (VALID_HOOKS.includes(hook)) return;
            problems.push(`options.preserveUnused[${i}]: unknown git hook "${hook}"`);
            unknownHook = true;
          });
        } else if (typeof value !== "boolean") {
          problems.push(`options.${name}: must be true or false`);
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
 *   hooks: Record<string, string | string[] | Record<string, unknown>>,
 *   preserveUnused: boolean | string[],
 *   options: Record<string, boolean>,
 * }>} `hooks` holds each hook as written: a command, a list of commands or an object. Use
 * `hookParts` to read one.
 */
export async function loadConfig(cwd = process.cwd(), { file } = {}) {
  const found = file ? readFile(cwd, file) : findConfig(cwd);
  if (!found) return { hooks: {}, preserveUnused: false, options: {} };

  const problems = validate(found.raw);
  if (problems.length) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${found.file}:`, ...lines].join("\n"));
  }

  const { options = {}, ...hooks } = found.raw;
  const { preserveUnused = false, ...flags } = options;
  return { hooks, preserveUnused, options: flags };
}
