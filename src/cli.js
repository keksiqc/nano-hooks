#!/usr/bin/env node
import { GLOBAL_OPTIONS, parseArgs } from "./args.js";
import { commands } from "./commands/index.js";
import { log } from "./log.js";
import { buildUsage } from "./usage.js";

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  const usage = buildUsage(commands, GLOBAL_OPTIONS);
  try {
    const { command, name, options, args } = parseArgs(argv, commands);
    if (!command) {
      log.error(`Unknown command "${name}".`);
      process.stderr.write(`\n${usage}`);
      return 1;
    }
    return await command.run({ options, args, usage });
  } catch (error) {
    log.error(error.message, { markup: false });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
