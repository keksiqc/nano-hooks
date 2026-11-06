/**
 * Options every command accepts. One with an `action` ends the parsing, and the CLI does
 * that action (`help` or `version`). One with an `arg` takes a value and sets `options[name]`.
 */
export const GLOBAL_OPTIONS = [
  {
    flags: ["-c", "--config"],
    arg: "<path>",
    name: "config",
    description: "Path to a nano-hooks configuration file",
  },
  { flags: ["-v", "--version"], action: "version", description: "Show the version" },
  { flags: ["-h", "--help"], action: "help", description: "Show this help" },
];

const spells = (option, arg) => option.flags.includes(arg);

/**
 * Options may appear before or after the command. Options that belong to one command are
 * read from the command table and rejected on the others. A help or version option wins
 * over every error that comes after it, also over an unknown command.
 *
 * @param {string[]} argv
 * @param {import("./commands/index.js").Command[]} commands
 * @returns {{action?: "help" | "version", command?: import("./commands/index.js").Command, name?: string, options: Record<string, unknown>, args: string[]}}
 *   `action` is set instead of `command` for a help or version option, and `name` is set
 *   instead of `command` when the command is unknown
 */
export function parseArgs(argv, commands) {
  const options = {};
  const scoped = []; // spellings of the command options, resolved once the command is known
  const args = [];
  let command;
  let unknown;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const global = GLOBAL_OPTIONS.find((option) => spells(option, arg));

    if (global?.action) return { action: global.action, options, args: [] };
    if (global) {
      const value = argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error(`Option "${arg}" needs a ${global.arg.slice(1, -1)}.`);
      }
      options[global.name] = value;
    } else if (arg.startsWith("-")) {
      if (!commands.some((c) => c.flags?.some((flag) => spells(flag, arg)))) {
        throw new Error(`Unknown option "${arg}".`);
      }
      scoped.push(arg);
    } else if (!command && !unknown) {
      command = commands.find((c) => c.name === arg);
      if (!command) unknown = arg;
      else if (command.passthrough === 0) {
        args.push(...argv.slice(i + 1));
        break;
      }
    } else {
      args.push(arg);
      if (args.length === command?.passthrough) {
        args.push(...argv.slice(i + 1));
        break;
      }
    }
  }

  if (unknown) return { name: unknown, options, args };
  command ??= commands.find((c) => c.default);
  if (command.passthrough === undefined && args.length) {
    throw new Error(`Unexpected argument "${args[0]}".`);
  }
  for (const arg of scoped) {
    const flag = command.flags?.find((f) => spells(f, arg));
    if (!flag) {
      const owners = commands.filter((c) => c.flags?.some((f) => spells(f, arg)));
      throw new Error(
        `Option "${arg}" only applies to ${owners.map((c) => `"${c.name}"`).join(" and ")}.`,
      );
    }
    options[flag.name] = flag.value;
  }
  return { command, options, args };
}
