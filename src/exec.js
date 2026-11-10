import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve } from "node:path";

/** A copy of `env` with every `node_modules/.bin` from `dir` up to the root first on PATH. */
export function envWithBin(dir, env = process.env) {
  const key = Object.keys(env).findLast((name) => name.toLowerCase() === "path") ?? "PATH";
  const bins = [];
  for (let current = resolve(dir); ; current = dirname(current)) {
    bins.push(join(current, "node_modules", ".bin"));
    if (dirname(current) === current) break;
  }
  return { ...env, [key]: [...bins, env[key]].filter(Boolean).join(delimiter) };
}

/**
 * Run `command` and resolve with its combined stdout and stderr. Rejects with an Error whose
 * message is the command output when it exits non-zero.
 * @param {string} command
 * @param {string[]} [args]
 * @param {{ cwd?: string, env?: Record<string, string>, signal?: AbortSignal }} [options]
 *   `env` is added to the environment of this process
 * @returns {Promise<string>}
 */
export function run(command, args = [], { cwd = process.cwd(), env, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (data) => (output += data));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(output.trim() || `${command} exited with code ${code}`));
    });
  });
}
