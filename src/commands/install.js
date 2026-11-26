import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { loadConfig } from "../config.js";
import { NotGitRepositoryError, createGit } from "../git.js";
import {
  MARKER,
  commandScript,
  hasForeignFiles,
  isManaged,
  managedHooks,
  removeHooks,
} from "../hooks.js";
import { log } from "../log.js";
import { realPath, toPosix } from "../paths.js";

export function registerInstallCommand(cli) {
  return cli
    .command("install", "Write the configured git hooks")
    .alias("!")
    .usage(`[command] [options] (default: ${install.name})`)
    .action(async ({ config }) => {
      if (process.env.NANO_HOOKS === "0") {
        log.info("Skipped install because NANO_HOOKS=0.");
        return 0;
      }

      let result;
      try {
        result = await install({ config });
      } catch (error) {
        if (!(error instanceof NotGitRepositoryError)) throw error;
        log.warn(`${error.message}. Hooks were not installed.`);
        return 0;
      }
      const { installed, removed, skipped, hooksDir, external, foreignHooksDir } = result;
      if (external && !foreignHooksDir) {
        log.info(
          `core.hooksPath is set: hooks go to ${relative(process.cwd(), hooksDir)} instead of .git/hooks.`,
        );
      }
      if (foreignHooksDir) {
        log.warn(
          `core.hooksPath points outside .git: ${hooksDir}. Another hooks manager, such as husky, can use the same directory. To write hooks to .git/hooks again, run: git config --unset core.hooksPath`,
        );
      }
      for (const name of installed) log.success(`Installed ${name}`);
      for (const name of removed) log.success(`Removed ${name} (no longer configured)`);
      for (const name of skipped) {
        log.warn(`Skipped ${name} because nano-hooks did not write the existing hook`);
      }
      if (installed.length === 0 && removed.length === 0 && skipped.length === 0) {
        log.info("No hooks to install.");
      }
      return 0;
    });
}

const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

async function relativeRoot(projectRoot) {
  try {
    const top = await createGit(projectRoot).toplevel();
    return toPosix(relative(realPath(top), realPath(projectRoot)));
  } catch {
    return "";
  }
}

function hookScript(binDir, script) {
  return [
    "#!/bin/sh",
    MARKER,
    'if [ "${SKIP_NANO_HOOKS:-}" = "1" ]; then',
    "  exit 0",
    "fi",
    `PATH="$PWD"/${quote(binDir)}:"$PATH"`,
    script,
    "",
  ].join("\n");
}

/**
 * Write the configured hook scripts and drop stale managed ones. `config` is a config file,
 * relative to `cwd`, to use instead of discovering one. `external` in the result is true when
 * `hooksDir` is outside the git directory because `core.hooksPath` points there, as husky does.
 * `foreignHooksDir` is true when that directory also holds files that nano-hooks did not write.
 */
export async function install({ cwd = process.cwd(), config } = {}) {
  const projectRoot = resolve(cwd);
  const { dir: hooksDir, external } = await createGit(projectRoot).hooksInfo();
  const { hooks, preserveUnused } = await loadConfig(projectRoot, { file: config });
  const binDir = toPosix(join(await relativeRoot(projectRoot), "node_modules", ".bin"));

  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const [name, value] of Object.entries(hooks)) {
    const path = join(hooksDir, name);
    if (existsSync(path) && !isManaged(path)) {
      skipped.push(name);
      continue;
    }
    writeFileSync(path, hookScript(binDir, commandScript(value)), { mode: 0o755 });
    chmodSync(path, 0o755);
    installed.push(name);
  }

  const keep = (name) =>
    name in hooks ||
    preserveUnused === true ||
    (Array.isArray(preserveUnused) && preserveUnused.includes(name));
  const removed = managedHooks(hooksDir).filter((name) => !keep(name));
  removeHooks(hooksDir, removed);

  return {
    installed,
    removed,
    skipped,
    hooksDir,
    external,
    foreignHooksDir: external && hasForeignFiles(hooksDir),
  };
}
