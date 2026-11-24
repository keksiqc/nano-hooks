import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { loadConfig } from "../config.js";
import { createGit } from "../git.js";
import {
  MARKER,
  commandScript,
  hasForeignFiles,
  isManaged,
  managedHooks,
  removeHooks,
} from "../hooks.js";
import { realPath, toPosix } from "../paths.js";

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
