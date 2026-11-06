import { command as init } from "./init.js";
import { command as install } from "./install.js";
import { command as run } from "./run.js";
import { command as staged } from "./staged.js";
import { command as uninstall } from "./uninstall.js";

/**
 * @typedef {object} Flag An option that belongs to one command.
 * @property {string[]} flags the spellings, such as `["--bail"]`
 * @property {string} name the key it sets in `options`
 * @property {unknown} value the value it sets
 * @property {string} description the line for the help
 */

/**
 * @typedef {object} Command
 * @property {string} name what the user types
 * @property {string} [usage] how the help lists it, when it takes arguments
 * @property {string} description one or more lines for the help
 * @property {boolean} [default] runs when no command is given
 * @property {Flag[]} [flags] options that only this command accepts
 * @property {string} [hook] the git hook that this command adds a step to. With `section`,
 *   the hook object accepts the key of the section, and the true or false keys of `flags`.
 * @property {{name: string, validate: (value: unknown, path: string) => string[]}} [section]
 *   a key of the hook object that belongs to this command. `validate` returns one line for
 *   each problem in the value, and `path` is the key as the user sees it, such as
 *   `pre-commit.staged`.
 * @property {(context: {loaded: object, cwd: string}) => number | Promise<number>} [hookStep]
 *   runs the step of the hook, from `nano-hooks run`. It returns the exit code.
 * @property {string} [note] extra lines for the help
 * @property {number} [passthrough] accepts arguments. Option parsing stops after this many
 *   arguments, and the rest go to the command untouched.
 * @property {(context: {options: Record<string, unknown>, args: string[]}) => number | Promise<number>} run
 *   returns the exit code. An error it throws is reported and exits with 1.
 */

/** The commands in the order the help lists them. */
export const commands = [init, install, uninstall, staged, run];
