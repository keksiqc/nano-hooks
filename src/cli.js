#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { NotGitRepositoryError } from "./git.js";
import { install, runHook, uninstall } from "./hooks.js";
import { log } from "./log.js";
import { runStaged } from "./staged.js";

const USAGE = `Usage: nano-hooks [command] [options]

Commands:
  install (default)  Write the configured git hooks
  uninstall          Remove the hooks nano-hooks manages
  staged             Run commands on staged files
  run <hook> [args]  Run the configured command of one git hook now

Options:
  -c, --config <path>  Path to a nano-hooks configuration file
  -v, --version        Show the version
  -h, --help           Show this help

Options for run:
  Arguments after <hook> go to the hook command as $1, $2 and so on, so put
  --config before <hook>.

Options for staged:
  --allow-empty        Allow empty commits
  --bail               Stop after the first failing command
`;

const STAGED_FLAGS = { "--allow-empty": "allowEmpty", "--bail": "bail" };

/**
 * Options may appear before or after the command. After `run <hook>`, everything is an
 * argument for the hook, so its own dashes are not mistaken for options.
 */
function parseArgs(argv) {
  const options = {};
  const stagedFlags = [];
  const positional = [];
  let hookArgs = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      return { command: "help", options, hookArgs };
    } else if (arg === "-v" || arg === "--version") {
      return { command: "version", options, hookArgs };
    } else if (arg === "-c" || arg === "--config") {
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
      if (positional[0] === "run" && positional.length === 2) {
        hookArgs = argv.slice(i + 1);
        break;
      }
    }
  }

  const [command = "install", ...extra] = positional;
  if (command === "run") {
    if (!extra.length) throw new Error('Command "run" needs a hook name.');
  } else if (extra.length) {
    throw new Error(`Unexpected argument "${extra[0]}".`);
  }
  if (command !== "staged" && stagedFlags.length) {
    throw new Error(`Option "${stagedFlags[0]}" only applies to "staged".`);
  }
  return { command, options, hook: extra[0], hookArgs };
}

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  try {
    const { command, options, hook, hookArgs } = parseArgs(argv);

    if (command === "help") {
      process.stdout.write(USAGE);
      return 0;
    }

    if (command === "version") {
      const manifest = new URL("../package.json", import.meta.url);
      process.stdout.write(`${JSON.parse(readFileSync(manifest, "utf8")).version}\n`);
      return 0;
    }

    if (command === "install") {
      // Lets CI and container builds run `prepare` without installing hooks.
      if (process.env.NANO_HOOKS === "0") {
        log.info("Skipped install because NANO_HOOKS=0.");
        return 0;
      }

      let result;
      try {
        result = await install({ config: options.config });
      } catch (error) {
        if (!(error instanceof NotGitRepositoryError)) throw error;
        // A `prepare` script must not fail an install where there is no .git directory.
        log.warn(`${error.message}. Hooks were not installed.`, { markup: false });
        return 0;
      }
      const { installed, removed, skipped, hooksDir, external } = result;
      if (external) {
        log.warn(
          `core.hooksPath points outside .git: ${hooksDir}. Another hooks manager, such as husky, can use the same directory.`,
          { markup: false },
        );
      }
      for (const name of installed) log.success(`Installed *${name}*`);
      for (const name of removed) log.success(`Removed *${name}* (no longer configured)`);
      for (const name of skipped) {
        log.warn(`Skipped *${name}* because nano-hooks did not write the existing hook`);
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

    if (command === "run") {
      // The hook command prints its own output and decides the exit code.
      return await runHook(hook, hookArgs, { config: options.config });
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
