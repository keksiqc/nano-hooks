import { parseArgs as parseNodeArgs } from "node:util";

import { installCommand } from "./commands/install.js";
import { runCommand } from "./commands/run.js";
import { stagedCommand } from "./commands/staged.js";
import { uninstallCommand } from "./commands/uninstall.js";

export const COMMANDS = [installCommand, uninstallCommand, stagedCommand, runCommand];

export const GLOBAL_OPTIONS = {
  config: {
    type: "string",
    short: "c",
    valueName: "path",
    description: "Path to a nano-hooks configuration file",
  },
  version: { type: "boolean", short: "v", description: "Show the version" },
  help: { type: "boolean", short: "h", description: "Show this help" },
};

const OPTIONS = Object.assign({}, GLOBAL_OPTIONS, ...COMMANDS.map(({ options }) => options));

/**
 * Options may appear before or after the command. The result has `action` ("help" or
 * "version") instead of `command` for those options, and `name` for an unknown command.
 * A bad option makes `util.parseArgs` throw.
 */
export function parseArgs(argv, defaultCommand) {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  if (values.version) return { action: "version" };
  if (values.help) return { action: "help" };

  const [name = defaultCommand, ...args] = positionals;
  const command = COMMANDS.find((candidate) => candidate.name === name);
  if (!command) return { name, options: {}, args };

  const parameters = command.positionals ?? [];
  const maxArgs = parameters.length;
  if (args.length > maxArgs) throw new Error(`Unexpected argument "${args[maxArgs]}".`);

  const options = values.config ? { config: values.config } : {};
  for (const owner of COMMANDS) {
    for (const [flag, { setting = flag, value = values[flag] }] of Object.entries(
      owner.options ?? {},
    )) {
      if (values[flag] === undefined) continue;
      if (command !== owner) {
        throw new Error(`Option "--${flag}" only applies to "${owner.name}".`);
      }
      options[setting] = value;
    }
  }

  const missing = parameters.find((_, index) => !args[index]);
  if (missing) throw new Error(`Command "${name}" needs ${missing.description}.`);

  return { command, options, args };
}
