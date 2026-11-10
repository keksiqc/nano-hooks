#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "./args.js";
import { runHook } from "./commands/run.js";
import { runConfiguredStaged } from "./commands/staged.js";
import { uninstall } from "./commands/uninstall.js";
import { loadConfig } from "./config.js";
import { NotGitRepositoryError } from "./git.js";
import { HELP } from "./help.js";
import { hasForeignFiles, install } from "./hooks.js";
import { log } from "./log.js";

/** Write the hooks and report what happened. @returns {Promise<number>} the exit code */
async function installHooks(config) {
  // Lets CI and container builds run `prepare` without installing hooks.
  if (process.env.NANO_HOOKS === "0") {
    log.info("Skipped install because NANO_HOOKS=0.");
    return 0;
  }

  let result;
  try {
    result = await install({ config });
  } catch (error) {
    if (!(error instanceof NotGitRepositoryError)) throw error;
    // A `prepare` script must not fail an install where there is no .git directory.
    log.warn(`${error.message}. Hooks were not installed.`);
    return 0;
  }
  const { installed, removed, skipped, hooksDir, external } = result;
  if (external && hasForeignFiles(hooksDir)) {
    log.warn(
      `core.hooksPath points outside .git: ${hooksDir}. Another hooks manager, such as husky, can use the same directory.`,
    );
  }
  for (const name of installed) log.success(`Installed ${name}`);
  for (const name of removed) log.success(`Removed ${name} (no longer configured)`);
  for (const name of skipped) {
    log.warn(`Skipped ${name} because nano-hooks did not write the existing hook`);
  }
  if (!installed.length && !removed.length && !skipped.length) {
    log.info("No hooks to install.");
  }
  return 0;
}

/** What each command does. Each returns the exit code, and an error it throws exits with 1. */
const handlers = {
  install: ({ options }) => installHooks(options.config),

  // Uninstall removes whatever nano-hooks wrote, so it reads no config. The --config option
  // is still accepted, so one set of options works for every command.
  async uninstall() {
    const { removed } = await uninstall();
    for (const name of removed) log.success(`Removed ${name}`);
    if (!removed.length) log.info("No nano-hooks hooks found.");
    return 0;
  },

  async staged({ options }) {
    const loaded = await loadConfig(process.cwd(), { file: options.config });
    return runConfiguredStaged({ loaded, flags: options });
  },

  // The hook command prints its own output and decides the exit code.
  run({ options, args: [hook] }) {
    if (!hook) throw new Error('Command "run" needs a hook name.');
    return runHook(hook, { config: options.config });
  },
};

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  try {
    const { action, command, name, options, args } = parseArgs(argv);
    if (action === "help") {
      process.stdout.write(HELP);
      return 0;
    }
    if (action === "version") {
      const manifest = new URL("../package.json", import.meta.url);
      process.stdout.write(`${JSON.parse(readFileSync(manifest, "utf8")).version}\n`);
      return 0;
    }
    if (!command) {
      log.error(`Unknown command "${name}".`);
      process.stderr.write(`\n${HELP}`);
      return 1;
    }
    return await handlers[command]({ options, args });
  } catch (error) {
    log.error(error.message);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
