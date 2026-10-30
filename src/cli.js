#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { install, uninstall } from "./hooks.js";
import { log } from "./log.js";
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
    else throw new Error(`Unknown option "${arg}".`);
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
      for (const name of installed) log.success(`Installed *${name}*`);
      for (const name of removed) log.success(`Removed *${name}* (no longer configured)`);
      for (const name of skipped) {
        log.warn(`Skipped *${name}* - existing hook is not managed by nano-hooks`);
      }
      if (!installed.length && !removed.length && !skipped.length) {
        log.info("No hooks to install.");
      }
      return 0;
    }

    if (command === "uninstall") {
      const { removed } = await uninstall();
      for (const name of removed) log.success(`Removed *${name}*`);
      if (!removed.length) log.info("No nano-hooks hooks found.");
      return 0;
    }

    if (command === "staged") {
      const options = parseStaged(args);
      if (!options.config) options.config = (await loadConfig()).staged;
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
    log.error(error.message, { markup: false });
    return 1;
  }

  log.error(`Unknown command "${command}".`);
  process.stderr.write(`\n${USAGE}`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
