import { parseArgs as parseNodeArgs } from "node:util";

/** The command names, in the order the help lists them. */
export const COMMANDS = ["install", "uninstall", "staged", "run"];

const DEFAULT_COMMAND = "install";

const STAGED_FLAGS = {
  "allow-empty": { allowEmpty: true },
  bail: { bail: true },
  "no-parallel": { parallel: false },
  "no-restage": { restage: false },
};

export const OPTIONS = {
  config: { type: "string", short: "c" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  ...Object.fromEntries(Object.keys(STAGED_FLAGS).map((flag) => [flag, { type: "boolean" }])),
};

/**
 * Options may appear before or after the command. The result has `action` ("help" or
 * "version") instead of `command` for those options, and `name` for an unknown command.
 * A bad option makes `util.parseArgs` throw.
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
  for (const [flag, settings] of Object.entries(STAGED_FLAGS)) {
    if (!values[flag]) continue;
    if (command !== "staged") throw new Error(`Option "--${flag}" only applies to "staged".`);
    Object.assign(options, settings);
  }
  return { command, options, args };
}
