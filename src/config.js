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

/**
 * What the configuration accepts besides the hooks. The commands add to it: each flag of a
 * command is a true or false key of `options`, and a command can own a whole section.
 * @param {import("./commands/index.js").Command[]} commands
 */
function schema(commands) {
  const sections = commands.flatMap((command) => command.section ?? []);
  const flags = [...new Set(commands.flatMap((command) => command.flags ?? []).map((f) => f.name))];
  return {
    sections,
    sectionNames: ["hooks", ...sections.map((s) => s.name), "options", "preserveUnused"],
    optionNames: [...flags, "preserveUnused"],
  };
}

/**
 * Search order. A dedicated file wins over the `package.json` key, because it is the more
 * specific choice. Among the dedicated files, plain data comes before code, so that a
 * configuration that needs no code execution is found first.
 */
const FILES = [".nano-hooks.json", ".nano-hooks.js", ".nano-hooks.mjs"];

export const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isCommand = (value) => typeof value === "string" && value.trim() !== "";
/** A command, or a non-empty list of commands. */
export const isCommandList = (value) =>
  isCommand(value) || (Array.isArray(value) && value.length > 0 && value.every(isCommand));

/** The error for a file that cannot be read or parsed. */
export const readFailure = (path, error) =>
  new Error(`Failed to read ${path}: ${error.message}`, { cause: error });

async function read(path) {
  try {
    if (!/\.[cm]?js$/.test(path)) return JSON.parse(readFileSync(path, "utf8"));
    const mod = await import(pathToFileURL(path).href);
    return mod.default ?? mod;
  } catch (error) {
    throw readFailure(path, error);
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

/** Find the config in `cwd`: the dedicated files in `FILES` order, then the package.json key. */
export async function findConfig(cwd) {
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
function validate(raw, { sections, sectionNames, optionNames }) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const key of Object.keys(raw)) {
    if (sectionNames.includes(key)) continue;
    const expected = `${sectionNames.slice(0, -1).join(", ")} or ${sectionNames.at(-1)}`;
    problems.push(
      VALID_HOOKS.includes(key)
        ? `${key}: hooks go under "hooks" (hooks.${key})`
        : `${key}: unknown option (expected ${expected})`,
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
        } else if (!isCommandList(command)) {
          problems.push(`hooks.${name}: must be a command or a non-empty list of commands`);
        }
      }
    }
  }

  // The top-level preserveUnused is the older spelling of options.preserveUnused.
  const checkPreserve = (value, path) => {
    if (value === undefined || typeof value === "boolean") return;
    if (!Array.isArray(value)) {
      problems.push(`${path}: must be true, false or a list of hook names`);
      return;
    }
    value.forEach((name, i) => {
      if (VALID_HOOKS.includes(name)) return;
      problems.push(`${path}[${i}]: unknown git hook "${name}"`);
      unknownHook = true;
    });
  };
  checkPreserve(raw.preserveUnused, "preserveUnused");

  if ("options" in raw) {
    if (!isObject(raw.options)) {
      problems.push("options: must be an object");
    } else {
      for (const [name, value] of Object.entries(raw.options)) {
        if (!optionNames.includes(name)) {
          problems.push(`options.${name}: unknown option (expected ${optionNames.join(", ")})`);
        } else if (name === "preserveUnused") {
          checkPreserve(value, "options.preserveUnused");
        } else if (typeof value !== "boolean") {
          problems.push(`options.${name}: must be true or false`);
        }
      }
    }
  }

  for (const { name, validate: check } of sections) {
    if (name in raw) problems.push(...check(raw[name]));
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
 *   hooks: Record<string, string | string[]>,
 *   preserveUnused: boolean | string[],
 *   options: Record<string, boolean>,
 * } & Record<string, unknown>>} one more key for each section that a command owns, such as
 * the `staged` section
 */
export async function loadConfig(cwd = process.cwd(), { file } = {}) {
  // The commands import this module, so their list loads on first use.
  const { commands } = await import("./commands/index.js");
  const rules = schema(commands);
  const found = file ? await readFile(cwd, file) : await findConfig(cwd);
  if (!found) return { hooks: {}, preserveUnused: false, options: {} };

  const problems = validate(found.raw, rules);
  if (problems.length) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${found.file}:`, ...lines].join("\n"));
  }

  const { hooks = {}, options = {} } = found.raw;
  // options.preserveUnused wins; the top-level key stays as a fallback for older configs.
  const { preserveUnused = found.raw.preserveUnused ?? false, ...flags } = options;
  const sections = Object.fromEntries(rules.sections.map(({ name }) => [name, found.raw[name]]));
  return { hooks, ...sections, preserveUnused, options: flags };
}
