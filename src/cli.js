#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { parseArgs } from "./args.js";
import { installCommand } from "./commands/install.js";
import { formatHelp } from "./help.js";
import { log } from "./log.js";

const DEFAULT_COMMAND = installCommand.name;
const HELP = formatHelp(DEFAULT_COMMAND);

async function main(argv) {
  try {
    const { action, command, name, options, args } = parseArgs(argv, DEFAULT_COMMAND);
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
    return await command.run({ options, args });
  } catch (error) {
    log.error(error.message);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
