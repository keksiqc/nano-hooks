#!/usr/bin/env node
import { install, uninstall } from "./hooks.js";
import { runStaged } from "./staged/index.js";

const USAGE = `Usage: nano-hooks [command]

Commands:
  install (default)  Write the configured git hooks
  uninstall          Remove the hooks nano-hooks manages
  staged             Run commands on staged files

Options for staged:
  -c, --config <path>  Path to a nano-staged config file
  --allow-empty        Allow empty commits
  --bail               Stop after the first failing command

Options:
  -h, --help           Show this help
`;

function parseStaged(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-c" || arg === "--config") options.config = args[++i];
    else if (arg === "--allow-empty") options.allowEmpty = true;
    else if (arg === "--bail") options.bail = true;
    else throw new Error(`unknown option "${arg}"`);
  }
  return options;
}

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }

  const [command = "install", ...args] = argv;

  try {
    if (command === "install") {
      const { installed, removed, skipped } = await install();
      for (const name of installed) console.log(`nano-hooks: installed ${name}`);
      for (const name of removed) console.log(`nano-hooks: removed ${name}`);
      for (const name of skipped)
        console.warn(`nano-hooks: skipped ${name} (existing hook is not managed by nano-hooks)`);
      return 0;
    }

    if (command === "uninstall") {
      const { removed } = await uninstall();
      for (const name of removed) console.log(`nano-hooks: removed ${name}`);
      return 0;
    }

    if (command === "staged") {
      const options = parseStaged(args);
      // Let rollback finish if the user interrupts a running commit.
      process.on("SIGINT", () => {});
      try {
        await runStaged(options);
      } catch {
        // runStaged has already reported the errors.
        return 1;
      }
      return 0;
    }
  } catch (error) {
    console.error(`nano-hooks: ${error.message.replace(/^nano-hooks: /, "")}`);
    return 1;
  }

  process.stderr.write(`nano-hooks: unknown command "${command}"\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
