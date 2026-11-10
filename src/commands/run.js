import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { VALID_HOOKS, hasStaged, hookParts, loadConfig } from "../config.js";
import { envWithBin } from "../exec.js";
import { commandScript } from "../hooks.js";
import { runConfiguredStaged } from "./staged.js";

/**
/**
 * Run one hook now, as git would: the `staged` step first, then the `run` commands in a `sh`
 * shell. A failing step stops the hook. Unlike an installed hook, it ignores
 * `SKIP_NANO_HOOKS`. Returns the exit code.
 */
export async function runHook(name, { cwd = process.cwd(), config } = {}) {
  if (!VALID_HOOKS.includes(name)) {
    throw new Error(`Unknown git hook "${name}". Valid hooks: ${VALID_HOOKS.join(", ")}`);
  }

  const projectRoot = resolve(cwd);
  const loaded = await loadConfig(projectRoot, { file: config });
  const value = loaded.hooks[name];
  if (value === undefined) throw new Error(`No command configured for hook "${name}".`);

  if (hasStaged(name, value)) {
    const code = await runConfiguredStaged({ loaded, cwd: projectRoot });
    if (code !== 0) return code;
  }
  const { run } = hookParts(value);
  if (run === undefined) return 0;

  const env = envWithBin(projectRoot);

  return new Promise((resolvePromise, reject) => {
    const child = spawn("sh", ["-c", commandScript(run)], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}
