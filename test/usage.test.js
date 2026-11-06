import { expect, it } from "vitest";
import { GLOBAL_OPTIONS } from "../src/args.js";
import { commands } from "../src/commands/index.js";
import { buildUsage } from "../src/usage.js";

it("builds the help text from the command table", () => {
  expect(buildUsage(commands, GLOBAL_OPTIONS)).toMatchInlineSnapshot(`
    "Usage: nano-hooks [command] [options]

    Commands:
      init [command]     Add a starter configuration to package.json (default command:
                         "<package manager> run lint") and install the hooks
      install (default)  Write the configured git hooks
      uninstall          Remove the hooks nano-hooks manages
      staged             Run commands on staged files
      run <hook> [args]  Run the configured command of one git hook now

    Options:
      -c, --config <path>  Path to a nano-hooks configuration file
      -v, --version        Show the version
      -h, --help           Show this help

    Options for staged:
      --allow-empty    Allow empty commits
      --bail           Stop after the first failing command
      --no-concurrent  Run the patterns one after the other

      These options can also be set in the "options" section of the configuration.
      A command line option wins over the configuration.

    Options for run:
      Arguments after <hook> go to the hook command as $1, $2 and so on, so put
      --config before <hook>.
    "
  `);
});
