import { STAGED_SETTINGS } from "./settings.js";

const stagedFlags = Object.values(STAGED_SETTINGS);
const flagWidth = Math.max(...stagedFlags.map(({ flag }) => flag.length));
const stagedLines = stagedFlags
  .map(({ flag, flagHelp }) => `  ${flag.padEnd(flagWidth)}  ${flagHelp}`)
  .join("\n");

/** The help text. Keep the commands in step with `args.js`. The `staged` options come from `settings.js`. */
export const HELP = `Usage: nano-hooks [command] [options]

Commands:
  install (default)  Write the configured git hooks
  uninstall          Remove the hooks nano-hooks manages
  staged             Run the commands of the "staged" key
  run <hook>         Run one configured git hook now

Options:
  -c, --config <path>  Path to a nano-hooks configuration file
  -v, --version        Show the version
  -h, --help           Show this help

Options for staged:
${stagedLines}

  These options can also be set in the "options" section of the configuration.
  A command line option wins over the configuration.
`;
