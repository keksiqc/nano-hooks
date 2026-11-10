// Shared helpers for the benchmarks. Adapted from nano-staged (MIT), see LICENSE.
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The runners to compare. `nano-hooks` is this checkout, the other two come from npm. */
export const RUNNERS = [
  { name: "lint-staged", spec: "lint-staged", args: [] },
  { name: "nano-staged", spec: "nano-staged", args: [] },
  { name: "nano-hooks", spec: "nano-hooks", args: ["staged"], local: true },
];

/** Run a command and return its stdout. Rejects with the stderr text if it fails. */
export async function exec(file, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(file, args, { ...options, maxBuffer: 1 << 26 });
    return stdout;
  } catch (error) {
    error.message += `\n${error.stderr ?? ""}`;
    throw error;
  }
}

export const makeTempDir = (prefix) => mkdtemp(join(tmpdir(), `${prefix}-`));

/** Pack this checkout the way `npm publish` would, so the local runner has the published files only. */
export async function packLocal(destination) {
  const output = await exec(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    { cwd: root },
  );
  // Older npm prints a list, newer npm prints an object keyed by package name.
  const result = JSON.parse(output);
  const [{ filename }] = Array.isArray(result) ? result : Object.values(result);
  return join(destination, filename);
}

/** Resolve what to hand to `npm install` for a runner. */
export async function installSpec(runner, tarballDir) {
  return runner.local ? packLocal(tarballDir) : runner.spec;
}

/** Install the packages into a project directory, without scripts, audit or funding noise. */
export function install(cwd, specs) {
  return exec(
    "npm",
    ["install", "--save-dev", "--ignore-scripts", "--no-audit", "--no-fund", ...specs],
    { cwd },
  );
}

/** Add up the size of every file under a directory. Symlinks count as themselves, not as their target. */
export async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(path);
    else total += (await lstat(path)).size;
  }
  return total;
}

export const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
