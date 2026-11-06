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

/** A copy of `env` with the `node_modules/.bin` directory of `root` first on PATH. */
export function envWithBin(root, env = process.env) {
  return {
    ...env,
    [PATH_KEY]: [join(root, "node_modules", ".bin"), env[PATH_KEY]].filter(Boolean).join(delimiter),
  };
}

/** The environment for a child: `node_modules/.bin` of the project comes first on PATH. */
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  const root = findProjectRoot(process.cwd());
  return root ? envWithBin(root, env) : env;
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
 * @typedef {object} ExecResult
 * @property {string} stdout the standard output
 * @property {string} stderr the standard error
 * @property {string} output stdout and stderr combined, in arrival order
 * @property {number | null} exitCode null when the process was killed by a signal
 */

/**
 * @typedef {object} ExecOptions
 * @property {string} [cwd] the working directory
 * @property {Record<string, string | undefined>} [env] merged over `process.env`; an
 * `undefined` value removes the variable
 * @property {AbortSignal} [signal] kills the process when aborted
 * @property {number} [timeout] milliseconds before the process is killed
 * @property {boolean} [throwOnError] reject on a non-zero exit code. Defaults to true.
 */

function failure(command, result, reason) {
  const error = new Error(result.output.trim() || reason);
  return Object.assign(error, { command, ...result });
}

/**
 * Run `command` without a shell, like tinyexec's `x`. Commands are looked up in the
 * project's `node_modules/.bin` before the regular PATH. Resolves with the exit code and
 * output; rejects when the command is missing, cannot start, times out, is aborted, or (with
 * `throwOnError`, the default) exits non-zero. Rejections carry `command`, `stdout`,
 * `stderr`, `output` and `exitCode`, and the message is the command output when there is any.
 * @param {string} command
 * @param {string[]} [args]
 * @param {ExecOptions} [options]
 * @returns {Promise<ExecResult>}
 */
export async function exec(
  command,
  args = [],
  { cwd = process.cwd(), env, signal, timeout, throwOnError = true } = {},
) {
  const fullEnv = childEnv(env);
  for (const key of Object.keys(fullEnv)) if (fullEnv[key] === undefined) delete fullEnv[key];
  const target = windowsCommand(which(command, fullEnv, cwd), args);

  return new Promise((resolvePromise, reject) => {
    const result = { stdout: "", stderr: "", output: "", exitCode: null };
    let timedOut = false;
    let settled = false;
    let timer;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const child = spawn(target.file, target.args, {
      cwd,
      env: fullEnv,
      signal,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: target.verbatim,
    });

    if (timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeout);
    }

    for (const name of ["stdout", "stderr"]) {
      child[name].setEncoding("utf8");
      child[name].on("data", (data) => {
        result[name] += data;
        result.output += data;
      });
    }

    child.on("error", (error) => settle(reject, Object.assign(error, { command, ...result })));
    child.on("close", (code) => {
      result.exitCode = code;
      if (timedOut)
        settle(reject, failure(command, result, `${command} timed out after ${timeout}ms`));
      else if (code === 0 || !throwOnError) settle(resolvePromise, result);
      else settle(reject, failure(command, result, `${command} exited with code ${code}`));
    });
  });
}

/**
 * Run `command` and resolve with its combined stdout and stderr. See {@link exec}.
 * @param {string} command
 * @param {string[]} [args]
 * @param {Omit<ExecOptions, "throwOnError">} [options]
 * @returns {Promise<string>}
 */
export async function run(command, args = [], options = {}) {
  return (await exec(command, args, options)).output;
}
