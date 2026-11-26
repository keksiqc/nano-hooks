import { access, readFile } from "node:fs/promises";
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

const CONFIG_NAME = "nano-hooks";
const PACKAGE_FILE = "package.json";
const CONFIG_FILES = [
  PACKAGE_FILE,
  ".nanohooks.json",
  ".nano-hooks.json",
  ".nano-hooks.config.json",
  "nanohooks.json",
  "nano-hooks.json",
  "nano-hooks.config.json",
  ".config/nanohooks.json",
  ".config/nano-hooks.json",
];

export const STAGED_DEFAULTS = {
  allowEmpty: false,
  bail: false,
  parallel: true,
  restage: true,
};

/**
 * The value of every setting. Each layer, from the first to the last, overrides the one before
 * it, and the defaults come first. A layer skips a setting that is `undefined`.
 */
export function resolveSettings(...layers) {
  const settings = {};
  for (const [name, defaultValue] of Object.entries(STAGED_DEFAULTS)) {
    settings[name] =
      layers.findLast((layer) => layer?.[name] !== undefined)?.[name] ?? defaultValue;
  }
  return settings;
}

/** A hook or `staged` entry holds one command or a list of commands. This gives the list. */
export const toCommandList = (command) => (Array.isArray(command) ? command : [command]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const NON_BLANK = /\S/u;
const nonBlankString = (value) => typeof value === "string" && NON_BLANK.test(value);

async function readConfigFile(path, file, { required = false } = {}) {
  const isJson = extname(path).toLowerCase() === ".json";
  let raw;
  try {
    // Check unsupported paths for existence without reading them.
    if (isJson) raw = JSON.parse(await readFile(path, "utf8"));
    else await access(path);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      if (required) throw new Error(`Configuration file ${file} not found.`, { cause: error });
      return;
    }
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }

  if (!isJson) {
    throw new Error(`${file}: nano-hooks reads only JSON configuration files.`);
  }
  if (basename(path) === PACKAGE_FILE) {
    if (!isObject(raw)) throw new Error(`${path}: ${PACKAGE_FILE} must contain an object.`);
    if (!Object.hasOwn(raw, CONFIG_NAME)) {
      if (required) throw new Error(`${file} has no "${CONFIG_NAME}" key.`);
      return;
    }
    raw = raw[CONFIG_NAME];
  }

  return { file, raw };
}

/** Find the config in `cwd`. More than one place is an error. */
async function findConfig(cwd) {
  const dir = resolve(cwd);
  const found = [];
  for (const file of CONFIG_FILES) {
    const source = await readConfigFile(join(dir, file), file);
    if (source) found.push(source);
  }

  if (found.length > 1) {
    const names = found.map(({ file }) => file).join(", ");
    throw new Error(
      `Found more than one nano-hooks configuration: ${names}. Keep one and delete the others.`,
    );
  }
  return found[0];
}

function validateHookName(name, path, report) {
  if (VALID_HOOKS.includes(name)) return true;
  report.problems.push(`${path}: unknown git hook ${JSON.stringify(name)}`);
  report.unknownHook = true;
  return false;
}

function validateCommands(value, path, report) {
  if (nonBlankString(value)) return;
  if (!Array.isArray(value) || value.length === 0) {
    report.problems.push(`${path}: must be a command or a non-empty list of commands`);
    return;
  }
  for (const [index, command] of value.entries()) {
    if (!nonBlankString(command)) {
      report.problems.push(`${path}[${index}]: must be a non-blank command string`);
    }
  }
}

function validateStaged(staged, report) {
  const entries = Object.entries(staged);
  if (entries.length === 0) {
    report.problems.push("staged: must have at least one pattern");
  }
  for (const [pattern, task] of entries) {
    const path = `staged[${JSON.stringify(pattern)}]`;
    validateCommands(task, path, report);
    if (pattern === "") {
      report.problems.push(`${path}: glob pattern must not be empty`);
      continue;
    }
    try {
      globToRegex(pattern);
    } catch (error) {
      report.problems.push(`${path}: ${error.message}`);
    }
  }
}

function validateHooks(hooks, report) {
  for (const [name, value] of Object.entries(hooks)) {
    const path = `hooks.${name}`;
    if (!validateHookName(name, path, report)) continue;
    if (isObject(value)) {
      report.problems.push(
        `${path}: an object is not allowed. Use a command or a list of commands. Move "staged" to the top level, and move allowEmpty, bail, parallel and restage to "options".`,
      );
    } else {
      validateCommands(value, path, report);
    }
  }
}

function validatePreserveUnused(value, report) {
  if (typeof value === "boolean") return;
  if (!Array.isArray(value)) {
    report.problems.push("options.preserveUnused: must be true, false or a list of hook names");
    return;
  }
  for (const [index, hook] of value.entries()) {
    const path = `options.preserveUnused[${index}]`;
    if (typeof hook === "string") {
      validateHookName(hook, path, report);
    } else {
      report.problems.push(`${path}: must be a git hook name string`);
    }
  }
}

function validateOptions(options, report) {
  for (const [name, value] of Object.entries(options)) {
    if (name === "preserveUnused") {
      validatePreserveUnused(value, report);
    } else if (!Object.hasOwn(STAGED_DEFAULTS, name)) {
      const expected = [...Object.keys(STAGED_DEFAULTS), "preserveUnused"].join(", ");
      report.problems.push(`options.${name}: unknown option (expected ${expected})`);
    } else if (typeof value !== "boolean") {
      report.problems.push(`options.${name}: must be true or false`);
    }
  }
}

const SECTION_VALIDATORS = {
  options: validateOptions,
  hooks: validateHooks,
  staged: validateStaged,
};

/** The problems of a raw configuration, as text. An empty list means it is valid. */
function validateConfig(raw) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const report = { problems: [], unknownHook: false };
  for (const [key, value] of Object.entries(raw)) {
    if (Object.hasOwn(SECTION_VALIDATORS, key)) {
      if (isObject(value)) {
        SECTION_VALIDATORS[key](value, report);
      } else {
        const expected =
          key === "staged" ? "an object mapping glob patterns to commands" : "an object";
        report.problems.push(`${key}: must be ${expected}`);
      }
    } else if (key === "$schema") {
      if (!nonBlankString(value)) report.problems.push("$schema: must be a non-blank string");
    } else if (VALID_HOOKS.includes(key)) {
      report.problems.push(`${key}: move this hook to "hooks.${key}"`);
    } else {
      report.problems.push(`${key}: unknown key (expected options, hooks, staged or $schema)`);
    }
  }

  if (report.unknownHook) report.problems.push(`Valid hooks: ${VALID_HOOKS.join(", ")}`);
  return report.problems;
}

function parseConfig({ file, raw }) {
  const problems = validateConfig(raw);
  if (problems.length > 0) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${file}:`, ...lines].join("\n"));
  }

  const { options = {}, hooks = {}, staged } = raw;
  const { preserveUnused = false, ...stagedOptions } = options;
  return { hooks, staged, preserveUnused, options: stagedOptions };
}

/**
 * Load the config from `cwd` (no upward search) or from `file`, relative to `cwd`. A missing
 * config is an empty one. An invalid config, or a named file that is missing, rejects.
 * `hooks` holds each hook as written, a command or a list of commands. `staged` is the
 * top-level `staged` key, or undefined.
 */
export async function loadConfig(cwd = process.cwd(), { file } = {}) {
  const source = file
    ? await readConfigFile(resolve(cwd, file), file, { required: true })
    : await findConfig(cwd);
  return source ? parseConfig(source) : { hooks: {}, preserveUnused: false, options: {} };
}
