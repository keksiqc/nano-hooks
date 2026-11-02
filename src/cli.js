#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { install, uninstall } from "./hooks.js";
import { log } from "./log.js";
import { runStaged } from "./staged.js";

const USAGE = `Usage: nano-hooks [command] [options]

Commands:
  install (default)  Write the configured git hooks
  uninstall          Remove the hooks nano-hooks manages
  staged             Run commands on staged files

Options:
  -c, --config <path>  Path to a nano-hooks config file
  -h, --help           Show this help

Options for staged:
  --allow-empty        Allow empty commits
  --bail               Stop after the first failing command
`;

const STAGED_FLAGS = { "--allow-empty": "allowEmpty", "--bail": "bail" };

/** Options may appear before or after the command. */
function parseArgs(argv) {
  const options = {};
  const stagedFlags = [];
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-c" || arg === "--config") {
      const value = argv[++i];
      if (!value || value.startsWith("-")) throw new Error(`Option "${arg}" needs a path.`);
      options.config = value;
    } else if (arg in STAGED_FLAGS) {
      options[STAGED_FLAGS[arg]] = true;
      stagedFlags.push(arg);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    } else {
      positional.push(arg);
    }
  }

  const [command = "install", ...extra] = positional;
  if (extra.length) throw new Error(`Unexpected argument "${extra[0]}".`);
  if (command !== "staged" && stagedFlags.length) {
    throw new Error(`Option "${stagedFlags[0]}" only applies to "staged".`);
  }
  return { command, options };
}

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    const { command, options } = parseArgs(argv);

    if (command === "install") {
      const { installed, removed, skipped } = await install({ config: options.config });
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

    // Uninstall removes whatever nano-hooks wrote, so it reads no config; --config is
    // accepted so one set of options works for every command.
    if (command === "uninstall") {
      const { removed } = await uninstall();
      for (const name of removed) log.success(`Removed *${name}*`);
      if (!removed.length) log.info("No nano-hooks hooks found.");
      return 0;
    }

    if (command === "staged") {
      const { staged } = await loadConfig(process.cwd(), { file: options.config });
      // Let rollback finish if the user interrupts a running commit.
      process.on("SIGINT", () => {});
      try {
        await runStaged({ config: staged, allowEmpty: options.allowEmpty, bail: options.bail });
      } catch {
        // runStaged has already reported the errors.
        return 1;
      }
      return 0;
    }

    log.error(`Unknown command "${command}".`);
    process.stderr.write(`\n${USAGE}`);
    return 1;
  } catch (error) {
    log.error(error.message, { markup: false });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
