/** The help text. Keep it in step with the commands and options in `args.js`. */
export const HELP = `Usage: nano-hooks [command] [options]

Commands:
  install (default)  Write the configured git hooks
  uninstall          Remove the hooks nano-hooks manages
  staged             Run the staged step of the pre-commit hook
  run <hook>         Run one configured git hook now

Options:
  -c, --config <path>  Path to a nano-hooks configuration file
  -v, --version        Show the version
  -h, --help           Show this help

Options for staged:
  --allow-empty  Allow empty commits
  --bail         Stop after the first failing command
  --no-parallel  Run the patterns one after the other
  --no-restage   Leave the changes of the commands out of the commit

  These options can also be set in the "pre-commit" hook or in the "options" section of
  the configuration. A command line option wins over the configuration.
`;
