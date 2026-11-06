import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { VALID_HOOKS, hookParts, loadConfig } from "../config.js";
import { envWithBin } from "../exec.js";
import { commandScript, hookSteps } from "../hooks.js";

/**
 * Run one hook now, as git would. The steps of the hook, such as `staged`, run first. Then
 * the `run` commands run in a `sh` shell with the output shown as it happens, and `args`
 * become their `$1`, `$2`, and so on. A step that fails stops the hook. Unlike an
 * installed hook, it ignores `SKIP_NANO_HOOKS`.
 * @param {string} name a git hook name, such as `pre-commit`
 * @param {string[]} [args] arguments git would pass to that hook
 * @param {{ cwd?: string, config?: string }} [options]
 * @returns {Promise<number>} the exit code of the command
 */
export async function runHook(name, args = [], { cwd = process.cwd(), config } = {}) {
  if (!VALID_HOOKS.includes(name)) {
    throw new Error(`Unknown git hook "${name}". Valid hooks: ${VALID_HOOKS.join(", ")}`);
  }

  const projectRoot = resolve(cwd);
  const loaded = await loadConfig(projectRoot, { file: config });
  const value = loaded.hooks[name];
  if (value === undefined) throw new Error(`No command configured for hook "${name}".`);

  for (const step of await hookSteps(name, value)) {
    const code = await step.hookStep({ loaded, cwd: projectRoot });
    if (code !== 0) return code;
  }
  const { run } = hookParts(value);
  if (run === undefined) return 0;

  const env = envWithBin(projectRoot);

  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", commandScript(run), name, ...args], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

/** @type {import("./index.js").Command} */
export const command = {
  name: "run",
  usage: "run <hook> [args]",
  description: "Run the configured command of one git hook now",
  // After `run <hook>`, everything is an argument for the hook.
  passthrough: 1,
  note: "Arguments after <hook> go to the hook command as $1, $2 and so on, so put\n--config before <hook>.",
  run({ options, args: [hook, ...hookArgs] }) {
    if (!hook) throw new Error('Command "run" needs a hook name.');
    // The hook command prints its own output and decides the exit code.
    return runHook(hook, hookArgs, { config: options.config });
  },
};
