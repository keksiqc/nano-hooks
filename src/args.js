/** The command names, in the order the help lists them. */
export const COMMANDS = ["install", "uninstall", "staged", "run"];

/** The command that runs when no command is given. */
const DEFAULT_COMMAND = "install";

/**
 * Commands that pass their arguments on. The number is how many arguments the command reads
 * itself: the rest go to the command untouched, and their dashes are not read as options.
 */
const PASSTHROUGH = { run: 1 };

/** The options of `staged`: the spelling, the key in the settings, and the value it sets. */
export const STAGED_OPTIONS = {
  "--allow-empty": ["allowEmpty", true],
  "--bail": ["bail", true],
  "--no-parallel": ["parallel", false],
  "--no-restage": ["restage", false],
};

/**
 * Options may appear before or after the command. A help or version option wins over every
 * error that comes after it, also over an unknown command.
 *
 * @param {string[]} argv
 * @returns {{action?: "help" | "version", command?: string, name?: string, options: Record<string, unknown>, args: string[]}}
 *   `action` is set instead of `command` for a help or version option, and `name` is set
 *   instead of `command` when the command is unknown
 */
export function parseArgs(argv) {
  const options = {};
  const staged = []; // options of `staged`, checked once the command is known
  const args = [];
  let command;
  let unknown;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-v" || arg === "--version") return { action: "version", options, args: [] };
    if (arg === "-h" || arg === "--help") return { action: "help", options, args: [] };
    if (arg === "-c" || arg === "--config") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error(`Option "${arg}" needs a path.`);
      options.config = value;
    } else if (arg.startsWith("-")) {
      if (!(arg in STAGED_OPTIONS)) throw new Error(`Unknown option "${arg}".`);
      staged.push(arg);
    } else if (!command && !unknown) {
      if (COMMANDS.includes(arg)) command = arg;
      else unknown = arg;
      if (PASSTHROUGH[command] === 0) {
        args.push(...argv.slice(i + 1));
        break;
      }
    } else {
      args.push(arg);
      if (args.length === PASSTHROUGH[command]) {
        args.push(...argv.slice(i + 1));
        break;
      }
    }
  }

  if (unknown) return { name: unknown, options, args };
  command ??= DEFAULT_COMMAND;
  if (PASSTHROUGH[command] === undefined && args.length) {
    throw new Error(`Unexpected argument "${args[0]}".`);
  }
  for (const arg of staged) {
    if (command !== "staged") throw new Error(`Option "${arg}" only applies to "staged".`);
    const [key, value] = STAGED_OPTIONS[arg];
    options[key] = value;
  }
  return { command, options, args };
}
