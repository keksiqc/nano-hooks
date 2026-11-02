import { isAbsolute, normalize, relative, resolve } from "node:path";
import { styleText } from "node:util";
import { run } from "./exec.js";
import { globToRegex } from "./glob.js";

/** Passed to function tasks so one config can serve different runners. */
const TASK_TYPE = "staged";

/** Matches a bare word, a quoted string, or a word with quoted parts, like a shell would. */
const ARGUMENT = /([^\s'"]([^\s'"]*(['"])([^\3]*?)\3)+[^\s'"]*)|[^\s'"]+|(['"])([^\5]*?)\5/g;

/** Thrown when one or more configured commands failed; the message is ready to print. */
export class CommandError extends Error {
  name = "CommandError";
}

/** Split a command line into arguments, honouring single and double quotes. */
export function splitCommand(command) {
  return Array.from(command.matchAll(ARGUMENT), (match) => match[1] ?? match[6] ?? match[0]);
}

/**
 * Build one task group per configured glob pattern, holding a task per command.
 * Groups without matching files get no tasks.
 * @param {object} options
 * @param {Record<string, string | string[] | Function>} options.config
 * @param {string[]} options.files staged files, relative to `rootPath`
 * @param {string} options.cwd only files below this directory are matched
 * @param {string} options.rootPath the repository root, where commands run
 */
export async function createCommandGroups({ config, files, cwd, rootPath }) {
  // File paths as seen from cwd, with forward slashes.
  const relativeFiles = files.map((file) =>
    normalize(relative(cwd, resolve(rootPath, file))).replaceAll("\\", "/"),
  );
  const groups = [];

  for (const [pattern, commands] of Object.entries(config)) {
    const matcher = globToRegex(pattern, { globstar: pattern.includes("/") });
    const matched = relativeFiles
      .filter((file) => {
        const outside = file.startsWith("..") || isAbsolute(file);
        return (pattern.startsWith("../") || !outside) && matcher.test(file);
      })
      .map((file) => resolve(cwd, file));

    const isFunction = typeof commands === "function";
    const lines = matched.length
      ? [].concat(isFunction ? await commands({ filenames: matched, type: TASK_TYPE }) : commands)
      : [];
    const suffix = matched.length
      ? `${matched.length} ${matched.length > 1 ? "files" : "file"}`
      : "no files";

    const group = {
      title: `${pattern}${styleText("dim", ` - ${suffix}`)}`,
      fileCount: matched.length,
    };
    group.tasks = lines.map((line) => {
      const [command, ...args] = splitCommand(line);
      return {
        title: line,
        pattern,
        parent: group,
        // A function has already chosen the arguments; a plain command gets the files.
        run: (signal) =>
          run(command, isFunction ? args : [...args, ...matched], { cwd: rootPath, signal }),
      };
    });
    groups.push(group);
  }

  return groups;
}

/** Run a group's commands in order; the rest are skipped after the first failure. */
async function runCommands(group, signal) {
  const errors = [];
  let failed = false;

  for (const task of group.tasks) {
    if (failed || signal?.aborted) {
      task.state = "warn";
      continue;
    }

    task.state = "run";
    try {
      await task.run(signal);
      task.state = "done";
    } catch (error) {
      if (signal?.aborted) {
        task.state = "warn";
        continue;
      }
      failed = true;
      task.state = "fail";
      task.title = styleText("red", task.title);
      errors.push(
        `${styleText("red", task.pattern)} ${styleText("dim", ">")} ${task.title}:\n${error.message.trim()}`,
      );
    }
  }

  return errors;
}

/**
 * Run the groups side by side. With `bail`, the first failing command aborts the rest.
 * @throws {CommandError} when any command failed
 */
export async function runCommandGroups(parent, groups, { bail = false } = {}) {
  const controller = bail ? new AbortController() : undefined;
  const errors = [];

  await Promise.all(
    groups.map(async (group) => {
      group.parent = parent;

      if (!group.fileCount || controller?.signal.aborted) {
        group.state = "warn";
        return;
      }

      group.state = "run";
      const failures = await runCommands(group, controller?.signal);
      if (failures.length) {
        group.state = "fail";
        errors.push(...failures);
        controller?.abort();
      } else {
        group.state = controller?.signal.aborted ? "warn" : "done";
      }
    }),
  );

  if (errors.length) throw new CommandError(errors.join("\n\n"));
}
