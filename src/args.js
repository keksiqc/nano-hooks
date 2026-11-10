import { parseArgs as parseNodeArgs } from "node:util";

/** The command names, in the order the help lists them. */
export const COMMANDS = ["install", "uninstall", "staged", "run"];

/** The command that runs when no command is given. */
const DEFAULT_COMMAND = "install";

/** The options of `staged`: the name, the key in the settings, and the value it sets. */
export const STAGED_OPTIONS = {
  "allow-empty": ["allowEmpty", true],
  bail: ["bail", true],
  "no-parallel": ["parallel", false],
  "no-restage": ["restage", false],
};

const OPTIONS = {
  config: { type: "string", short: "c" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  ...Object.fromEntries(Object.keys(STAGED_OPTIONS).map((name) => [name, { type: "boolean" }])),
};

/**
 * Options may appear before or after the command. A bad option makes `util.parseArgs` throw.
 *
 * @param {string[]} argv
 * @returns {{action?: "help" | "version", command?: string, name?: string, options: Record<string, unknown>, args: string[]}}
 *   `action` is set instead of `command` for a help or version option, and `name` is set
 *   instead of `command` when the command is unknown
 */
export function parseArgs(argv) {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  if (values.version) return { action: "version" };
  if (values.help) return { action: "help" };

  const [command = DEFAULT_COMMAND, ...args] = positionals;
  if (!COMMANDS.includes(command)) return { name: command, options: {}, args };

  const maxArgs = command === "run" ? 1 : 0;
  if (args.length > maxArgs) throw new Error(`Unexpected argument "${args[maxArgs]}".`);

  const options = values.config ? { config: values.config } : {};
  for (const [name, [key, value]] of Object.entries(STAGED_OPTIONS)) {
    if (!values[name]) continue;
    if (command !== "staged") throw new Error(`Option "--${name}" only applies to "staged".`);
    options[key] = value;
  }
  return { command, options, args };
}
