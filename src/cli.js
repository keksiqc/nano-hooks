#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { GLOBAL_OPTIONS, parseArgs } from "./args.js";
import { commands } from "./commands/index.js";
import { log } from "./log.js";
import { buildUsage } from "./usage.js";

/** @returns {Promise<number>} the process exit code */
async function main(argv) {
  const usage = buildUsage(commands, GLOBAL_OPTIONS);
  try {
    const { action, command, name, options, args } = parseArgs(argv, commands);
    if (action === "help") {
      process.stdout.write(usage);
      return 0;
    }
    if (action === "version") {
      const manifest = new URL("../package.json", import.meta.url);
      process.stdout.write(`${JSON.parse(readFileSync(manifest, "utf8")).version}\n`);
      return 0;
    }
    if (!command) {
      log.error(`Unknown command "${name}".`);
      process.stderr.write(`\n${usage}`);
      return 1;
    }
    return await command.run({ options, args });
  } catch (error) {
    log.error(error.message, { markup: false });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
