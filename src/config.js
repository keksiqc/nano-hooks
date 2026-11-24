import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { globToRegex } from "./glob.js";
import { SETTING_NAMES } from "./settings.js";

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

/** The names of the hooks, as one line for an error message. */
export const VALID_HOOKS_HINT = `Valid hooks: ${VALID_HOOKS.join(", ")}`;

const OPTION_NAMES = [...SETTING_NAMES, "preserveUnused"];

const FILES = ["nano-hooks.config.json", ".nano-hooks.json"];

/** A hook or `staged` entry holds one command or a list of commands. This gives the list. */
export const toCommandList = (command) => (Array.isArray(command) ? command : [command]);

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

/** What the validators collect: the problems, and whether one of them names an unknown hook. */
const createReport = () => ({ problems: [], unknownHook: false });

function reportUnknownHook(report, problem) {
  report.problems.push(problem);
  report.unknownHook = true;
}

function validateCommands(value, path, report) {
  if (Array.isArray(value) && value.length > 0) {
    for (const [index, command] of value.entries()) {
      if (!nonBlankString(command))
        report.problems.push(`${path}[${index}]: must be a non-blank command string`);
    }
  } else if (!nonBlankString(value)) {
    report.problems.push(`${path}: must be a command or a non-empty list of commands`);
  }
}

function validateStaged(staged, report) {
  if (!isObject(staged)) {
    report.problems.push("staged: must be an object mapping glob patterns to commands");
    return;
  }
  if (Object.keys(staged).length === 0) {
    report.problems.push("staged: must have at least one pattern");
  }
  for (const [pattern, task] of Object.entries(staged)) {
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
  if (!isObject(hooks)) {
    report.problems.push("hooks: must be an object");
    return;
  }
  for (const [name, value] of Object.entries(hooks)) {
    const path = `hooks.${name}`;
    if (!VALID_HOOKS.includes(name)) {
      reportUnknownHook(report, `${path}: unknown git hook ${JSON.stringify(name)}`);
    } else if (isObject(value)) {
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
  for (const [i, hook] of value.entries()) {
    if (typeof hook !== "string") {
      report.problems.push(`options.preserveUnused[${i}]: must be a git hook name string`);
    } else if (!VALID_HOOKS.includes(hook)) {
      reportUnknownHook(
        report,
        `options.preserveUnused[${i}]: unknown git hook ${JSON.stringify(hook)}`,
      );
    }
  }
}

function validateOptions(options, report) {
  if (!isObject(options)) {
    report.problems.push("options: must be an object");
    return;
  }
  for (const [name, value] of Object.entries(options)) {
    if (!OPTION_NAMES.includes(name)) {
      report.problems.push(`options.${name}: unknown option (expected ${OPTION_NAMES.join(", ")})`);
    } else if (name === "preserveUnused") {
      validatePreserveUnused(value, report);
    } else if (typeof value !== "boolean") {
      report.problems.push(`options.${name}: must be true or false`);
    }
  }
}

/** The problems of a raw configuration, as text. An empty list means it is valid. */
function validate(raw) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const report = createReport();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "options") {
      validateOptions(value, report);
    } else if (key === "hooks") {
      validateHooks(value, report);
    } else if (key === "staged") {
      validateStaged(value, report);
    } else if (key === "$schema") {
      if (!nonBlankString(value)) report.problems.push("$schema: must be a non-blank string");
    } else if (VALID_HOOKS.includes(key)) {
      report.problems.push(`${key}: move this hook to "hooks.${key}"`);
    } else {
      report.problems.push(`${key}: unknown key (expected options, hooks, staged or $schema)`);
    }
  }

  if (report.unknownHook) report.problems.push(VALID_HOOKS_HINT);
  return report.problems;
}

/**
 * Load the config from `cwd` (no upward search) or from `file`, relative to `cwd`. A missing
 * config is an empty one. An invalid config, or a named file that is missing, rejects.
 * `hooks` holds each hook as written, a command or a list of commands. `staged` is the
 * top-level `staged` key, or undefined.
 */
// eslint-disable-next-line require-await -- a problem in the file must reject, not throw
export async function loadConfig(cwd = process.cwd(), { file } = {}) {
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
