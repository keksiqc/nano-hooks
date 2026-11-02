import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, resolve } from "node:path";

const IS_WINDOWS = process.platform === "win32";
const PATH_KEY = IS_WINDOWS
  ? (Object.keys(process.env).findLast((key) => key.toLowerCase() === "path") ?? "Path")
  : "PATH";
const PATH_EXTENSIONS = IS_WINDOWS
  ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
  : [];

const RE_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;
const RE_CMD_SHIM = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
const RE_CMD_FILE = /\.(?:cmd|bat)$/i;

/** The nearest directory above `start` that has a package.json or node_modules. */
function findProjectRoot(start) {
  let dir = resolve(start);
  while (basename(dir) === "node_modules") dir = dirname(dir);

  for (;;) {
    if (existsSync(join(dir, "package.json")) || existsSync(join(dir, "node_modules"))) return dir;
    if (dirname(dir) === dir) return undefined;
    dir = dirname(dir);
  }
}

/** The environment for a child: `node_modules/.bin` of the project comes first on PATH. */
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  const root = findProjectRoot(process.cwd());
  if (root) {
    env[PATH_KEY] = [join(root, "node_modules", ".bin"), env[PATH_KEY]]
      .filter(Boolean)
      .join(delimiter);
  }
  return env;
}

function isExecutable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!IS_WINDOWS) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve `command` to an executable file, searching PATH unless it names a path. */
function which(command, env, cwd) {
  const isPath = command.includes("/") || (IS_WINDOWS && command.includes("\\"));
  const bases = isPath
    ? [resolve(cwd, command)]
    : (env[PATH_KEY] ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, command));

  for (const base of bases) {
    const hasExtension = PATH_EXTENSIONS.includes(extname(base).toUpperCase());
    const candidates = IS_WINDOWS
      ? [...(hasExtension ? [base] : []), ...PATH_EXTENSIONS.map((ext) => base + ext)]
      : [base];
    const found = candidates.find(isExecutable);
    if (found) return found;
  }
  throw new Error(`${command} does not exist`);
}

// cmd.exe quoting, as done by cross-spawn.
const escapeCommand = (arg) => arg.replace(RE_META_CHARS, "^$1");

function escapeArgument(arg, doubleEscape) {
  let escaped = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  escaped = escaped.replace(RE_META_CHARS, "^$1");
  return doubleEscape ? escaped.replace(RE_META_CHARS, "^$1") : escaped;
}

/** .cmd and .bat files can only be started through cmd.exe on Windows. */
function windowsCommand(file, args) {
  if (!IS_WINDOWS || !RE_CMD_FILE.test(file)) return { file, args, verbatim: false };

  const doubleEscape = RE_CMD_SHIM.test(file);
  const line = [escapeCommand(file), ...args.map((arg) => escapeArgument(arg, doubleEscape))];
  return {
    file: process.env.COMSPEC || "cmd.exe",
    args: [`/D /S /C "${line.join(" ")}"`],
    verbatim: true,
  };
}

/**
 * Run `command` and resolve with its combined stdout and stderr. Commands are looked up in
 * the project's `node_modules/.bin` before the regular PATH. Rejects with an Error whose
 * message is the command output when it exits non-zero.
 * @param {string} command
 * @param {string[]} [args]
 * @param {{ cwd?: string, env?: Record<string, string>, signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export async function run(command, args = [], { cwd = process.cwd(), env, signal } = {}) {
  const fullEnv = childEnv(env);
  const target = windowsCommand(which(command, fullEnv, cwd), args);

  return new Promise((resolvePromise, reject) => {
    const child = spawn(target.file, target.args, {
      cwd,
      env: fullEnv,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: target.verbatim,
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
