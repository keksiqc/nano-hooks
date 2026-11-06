import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

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
 * command is a true or false key of `options`, and a command can add a step to one hook,
 * with a key of its own and settings in that hook.
 * @param {import("./commands/index.js").Command[]} commands
 */
function schema(commands) {
  const flags = [...new Set(commands.flatMap((command) => command.flags ?? []).map((f) => f.name))];
  return { commands, optionNames: [...flags, "preserveUnused"] };
}

/** The JSON files to search for, after the `nano-hooks` key of `package.json`. */
const FILES = ["nano-hooks.config.json", ".nano-hooks.json"];

/** Files that older versions read. They are not read now, so finding one is an error. */
const LEGACY_FILES = [".nano-hooks.js", ".nano-hooks.mjs"];

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
  const legacy = LEGACY_FILES.find((file) => existsSync(join(cwd, file)));
  if (legacy) {
    throw new Error(
      `Found ${legacy}. nano-hooks reads only JSON configuration. Move it to the "nano-hooks" key of package.json or to ${FILES[0]}, then delete ${legacy}. See MIGRATION.md.`,
    );
  }

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

/** What a command adds to one hook: its own key, and its settings. */
const extensionKeys = (command) => [
  command.section.name,
  ...(command.flags ?? []).map((f) => f.name),
];

/** The problems in one hook, as lines naming the key. */
function validateHook(name, value, commands) {
  if (isCommandList(value)) return [];
  if (!isObject(value)) return [`${name}: must be a command, a list of commands or an object`];

  const extensions = commands.filter((command) => command.hook === name && command.section);
  const allowed = ["run", ...extensions.flatMap(extensionKeys)];
  const problems = [];

  for (const [key, entry] of Object.entries(value)) {
    const path = `${name}.${key}`;
    const owner = commands.find(
      (command) => command.hook && command.section && extensionKeys(command).includes(key),
    );
    const section = extensions.find((command) => command.section.name === key);
    if (key === "run") {
      if (!isCommandList(entry)) problems.push(`${path}: ${NO_COMMAND}`);
    } else if (section) {
      problems.push(...section.section.validate(entry, path));
    } else if (extensions.some((command) => extensionKeys(command).includes(key))) {
      if (typeof entry !== "boolean") problems.push(`${path}: must be true or false`);
    } else if (owner) {
      problems.push(`${path}: only the "${owner.hook}" hook accepts this key`);
    } else {
      problems.push(`${path}: unknown key (expected ${allowed.join(", ")})`);
    }
  }

  const needed = ["run", ...extensions.map((command) => command.section.name)];
  if (!needed.some((key) => key in value)) {
    problems.push(`${name}: needs ${needed.map((key) => `"${key}"`).join(" or ")}`);
  }
  return problems;
}

/** The hint for a top-level key that version 0.4 read, or nothing for any other key. */
function migrationHint(key, commands) {
  if (key === "hooks") {
    return 'hooks: removed. Put each hook at the top level, for example "pre-commit": "pnpm lint". See MIGRATION.md.';
  }
  if (key === "preserveUnused") return "preserveUnused: moved to options.preserveUnused";
  const owner = commands.find((command) => command.hook && command.section?.name === key);
  if (owner) {
    return `${key}: moved into the "${owner.hook}" hook, as in "${owner.hook}": { "${key}": ... }. See MIGRATION.md.`;
  }
}

/** Collect every problem in the config, as lines naming the offending key. */
function validate(raw, { commands, optionNames }) {
  if (!isObject(raw)) return ["configuration must be an object"];

  const problems = [];
  let unknownHook = false;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "options") continue;
    if (VALID_HOOKS.includes(key)) {
      problems.push(...validateHook(key, value, commands));
    } else if (migrationHint(key, commands)) {
      problems.push(migrationHint(key, commands));
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
        if (!optionNames.includes(name)) {
          problems.push(`options.${name}: unknown option (expected ${optionNames.join(", ")})`);
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
  // The commands import this module, so their list loads on first use.
  const { commands } = await import("./commands/index.js");
  const found = file ? readFile(cwd, file) : findConfig(cwd);
  if (!found) return { hooks: {}, preserveUnused: false, options: {} };

  const problems = validate(found.raw, schema(commands));
  if (problems.length) {
    const lines = problems.map((problem) => `  ${problem}`);
    throw new Error([`Invalid nano-hooks configuration in ${found.file}:`, ...lines].join("\n"));
  }

  const { options = {}, ...hooks } = found.raw;
  const { preserveUnused = false, ...flags } = options;
  return { hooks, preserveUnused, options: flags };
}
