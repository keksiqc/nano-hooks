import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { toCommandList } from "./config.js";

const MARKER = "# nano-hooks: managed file, do not edit";
const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The shell code for a command or a list of commands. The first failure stops the list. Each
 * command but the last is in braces, so a `;` or `||` inside it cannot change where it stops.
 */
export function commandScript(command) {
  const lines = toCommandList(command);
  return lines
    .map((line, i) => (i === lines.length - 1 ? line : `{ ${line}\n} || exit $?`))
    .join("\n");
}

function hookScript(binDir, command) {
  return [
    "#!/bin/sh",
    MARKER,
    'if [ "${SKIP_NANO_HOOKS:-}" = "1" ] || [ "${NANO_HOOKS:-}" = "0" ]; then',
    "  exit 0",
    "fi",
    `PATH="$PWD"/${quote(binDir)}:"$PATH"`,
    commandScript(command),
    "",
  ].join("\n");
}

function hookOwnership(path, entry = lstatSync(path, { throwIfNoEntry: false })) {
  if (!entry) return "missing";
  return entry.isFile() && readFileSync(path, "utf8").includes(MARKER) ? "managed" : "foreign";
}

function writeManagedHook(path, script) {
  const ownership = hookOwnership(path);
  if (ownership === "foreign") return false;

  try {
    writeFileSync(path, script, { mode: 0o755, flag: ownership === "missing" ? "wx" : "w" });
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  chmodSync(path, 0o755);
  return true;
}

/** Write the configured scripts and remove stale managed hooks unless preserved. */
export function installManagedHooks({ hooksDir, hooks, binDir, preserveUnused }) {
  mkdirSync(hooksDir, { recursive: true });
  const installed = [];
  const skipped = [];
  for (const [name, command] of Object.entries(hooks)) {
    const written = writeManagedHook(join(hooksDir, name), hookScript(binDir, command));
    (written ? installed : skipped).push(name);
  }

  const keep = (name) =>
    name in hooks ||
    preserveUnused === true ||
    (Array.isArray(preserveUnused) && preserveUnused.includes(name));
  const { removed, hasForeignEntries } = removeManagedHooks(hooksDir, keep);
  return { installed, removed, skipped, hasForeignEntries };
}

/** Remove managed scripts unless `keep` selects them, and report other entries. */
export function removeManagedHooks(hooksDir, keep = () => false) {
  const removed = [];
  if (!existsSync(hooksDir)) return { removed, hasForeignEntries: false };

  const entries = readdirSync(hooksDir, { withFileTypes: true }).map((entry) => {
    const path = join(hooksDir, entry.name);
    return { name: entry.name, path, ownership: hookOwnership(path, entry) };
  });
  for (const { name, path, ownership } of entries) {
    if (ownership !== "managed" || keep(name)) continue;
    unlinkSync(path);
    removed.push(name);
  }
  return { removed, hasForeignEntries: entries.some(({ ownership }) => ownership === "foreign") };
}
