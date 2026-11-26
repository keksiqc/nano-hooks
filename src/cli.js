#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { cac } from "cac";

import { registerInstallCommand } from "./commands/install.js";
import { registerRunCommand } from "./commands/run.js";
import { registerStagedCommand } from "./commands/staged.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { log } from "./log.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const cli = cac("nano-hooks")
  .option("-c, --config <path>", "Path to a nano-hooks configuration file")
  .help()
  .version(version);

registerInstallCommand(cli);
registerUninstallCommand(cli);
registerStagedCommand(cli);
registerRunCommand(cli);

try {
  const { options } = cli.parse(process.argv, { run: false });
  // CAC leaves an explicitly named command pending when --version is present.
  if (options.version && cli.matchedCommand) {
    cli.outputVersion();
  } else {
    process.exitCode = await cli.runMatchedCommand();
  }
} catch (error) {
  log.error(error.message);
  process.exitCode = 1;
}
