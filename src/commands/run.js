import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { VALID_HOOKS, formatValidHooks, loadConfig } from "../lib/config.js";
import { envWithBin } from "../lib/exec.js";
import { commandScript } from "../lib/hooks.js";

export function registerRunCommand(cli) {
  return cli
    .command("run <hook>", "Run one configured git hook now")
    .action((hook, { config }) => runHook(hook, { config }));
}

/**
 * Run one hook now in a `sh` shell. A failing command stops the hook. An explicit run ignores
 * `SKIP_NANO_HOOKS` and `NANO_HOOKS`. Returns the exit code.
 */
export async function runHook(name, { cwd = process.cwd(), config } = {}) {
  if (!VALID_HOOKS.includes(name)) {
    throw new Error(`Unknown git hook "${name}". ${formatValidHooks()}`);
  }

  const projectRoot = resolve(cwd);
  const loaded = await loadConfig(projectRoot, { file: config });
  const value = loaded.hooks[name];
  if (value === undefined) throw new Error(`No command configured for hook "${name}".`);

  const env = envWithBin(projectRoot);

  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", commandScript(value)], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}
