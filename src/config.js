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

/** The true or false settings of the `staged` step. Each one is a flag of `nano-hooks staged`. */
export const SETTINGS = ["allowEmpty", "bail", "parallel", "restage"];

const OPTIONS = [...SETTINGS, "preserveUnused"];

const FILES = ["nano-hooks.config.json", ".nano-hooks.json"];

export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const NON_BLANK = /\S/u;
const nonBlankString = (value) => typeof value === "string" && NON_BLANK.test(value);

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

function readPackageConfig(path) {
  const pkg = read(path);
  if (!isObject(pkg)) throw new Error(`${path}: package.json must contain an object.`);
  return pkg["nano-hooks"];
}

function readFile(cwd, file) {
  const path = resolve(cwd, file);
  if (!existsSync(path)) throw new Error(`Configuration file ${file} not found.`);
  if (extname(path).toLowerCase() !== ".json") {
    throw new Error(`${file}: nano-hooks reads only JSON configuration files.`);
  }
  if (basename(path) !== "package.json") return { file, raw: read(path) };

  const raw = readPackageConfig(path);
  if (raw === undefined) throw new Error(`${file} has no "nano-hooks" key.`);
  return { file, raw };
}

/**
/** Find the config in `cwd`. More than one place is an error. */
export function findConfig(cwd) {
  const found = [];
  const pkg = join(cwd, "package.json");
  if (existsSync(pkg)) {
    const raw = readPackageConfig(pkg);
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

function validateCommands(value, path, problems) {
  if (Array.isArray(value) && value.length > 0) {
    for (const [index, command] of value.entries()) {
      if (!nonBlankString(command))
        problems.push(`${path}[${index}]: must be a non-blank command string`);
    }
  } else if (!nonBlankString(value)) {
    problems.push(`${path}: must be a command or a non-empty list of commands`);
  }
}

function validateStaged(staged, problems) {
  if (!isObject(staged)) {
    problems.push("staged: must be an object mapping glob patterns to commands");
    return;
  }
  if (Object.keys(staged).length === 0) problems.push("staged: must have at least one pattern");
  for (const [pattern, task] of Object.entries(staged)) {
    const path = `staged[${JSON.stringify(pattern)}]`;
    validateCommands(task, path, problems);
    if (pattern === "") {
      problems.push(`${path}: glob pattern must not be empty`);
      continue;
    }
    try {
      globToRegex(pattern);
    } catch (error) {
      problems.push(`${path}: ${error.message}`);
    }
  }
}

/** Check the `hooks` object. True when it names an unknown hook. */
function validateHooks(hooks, problems) {
  if (!isObject(hooks)) {
    problems.push("hooks: must be an object");
    return false;
  }
  let unknownHook = false;
  for (const [name, value] of Object.entries(hooks)) {
    const path = `hooks.${name}`;
    if (!VALID_HOOKS.includes(name)) {
      problems.push(`${path}: unknown git hook ${JSON.stringify(name)}`);
      unknownHook = true;
    } else if (isObject(value)) {
      problems.push(
        `${path}: an object is not allowed. Use a command or a list of commands. Move "staged" to the top level, and move allowEmpty, bail, parallel and restage to "options".`,
      );
    } else {
      validateCommands(value, path, problems);
    }
  }
  return unknownHook;
}

/** Check `options.preserveUnused`. True when it names an unknown hook. */
function validatePreserveUnused(value, problems) {
  if (typeof value === "boolean") return false;
  if (!Array.isArray(value)) {
    problems.push("options.preserveUnused: must be true, false or a list of hook names");
    return false;
  }
  let unknownHook = false;
  for (const [i, hook] of value.entries()) {
    if (typeof hook !== "string") {
      problems.push(`options.preserveUnused[${i}]: must be a git hook name string`);
    } else if (!VALID_HOOKS.includes(hook)) {
      problems.push(`options.preserveUnused[${i}]: unknown git hook ${JSON.stringify(hook)}`);
      unknownHook = true;
    }
  }
  return unknownHook;
}

/** Check the `options` object. True when `preserveUnused` names an unknown hook. */
function validateOptions(options, problems) {
  if (!isObject(options)) {
    problems.push("options: must be an object");
    return false;
  }
  let unknownHook = false;
  for (const [name, value] of Object.entries(options)) {
    if (!OPTIONS.includes(name)) {
      problems.push(`options.${name}: unknown option (expected ${OPTIONS.join(", ")})`);
    } else if (name === "preserveUnused") {
      unknownHook = validatePreserveUnused(value, problems) || unknownHook;
    } else if (typeof value !== "boolean") {
      problems.push(`options.${name}: must be true or false`);
    }
  }
  return unknownHook;
}

function validate(raw) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "options") {
      unknownHook = validateOptions(value, problems) || unknownHook;
    } else if (key === "hooks") {
      unknownHook = validateHooks(value, problems) || unknownHook;
    } else if (key === "staged") {
      validateStaged(value, problems);
    } else if (key === "$schema") {
      if (!nonBlankString(value)) problems.push("$schema: must be a non-blank string");
    } else if (VALID_HOOKS.includes(key)) {
      problems.push(`${key}: move this hook to "hooks.${key}"`);
    } else {
      problems.push(`${key}: unknown key (expected options, hooks, staged or $schema)`);
    }
  }

  if (unknownHook) problems.push(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  return problems;
}

/**
/**
 * Load the config from `cwd` (no upward search) or from `file`, relative to `cwd`. A missing
 * config is an empty one. An invalid config, or a named file that is missing, rejects.
 * `hooks` holds each hook as written, a command or a list of commands. `staged` is the
 * top-level `staged` key, or undefined.
 */
export function loadConfig(cwd = process.cwd(), { file } = {}) {
  return new Promise((done) => {
    done(loadConfigSync(cwd, file));
  });
}

function loadConfigSync(cwd, file) {
  const found = file ? readFile(cwd, file) : findConfig(cwd);
  if (!found) return { hooks: {}, preserveUnused: false, options: {} };

  const problems = validate(found.raw);
  if (problems.length > 0) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${found.file}:`, ...lines].join("\n"));
  }

  const { options = {}, hooks = {}, staged } = found.raw;
  const { preserveUnused = false, ...flags } = options;
  return { hooks, staged, preserveUnused, options: flags };
}
