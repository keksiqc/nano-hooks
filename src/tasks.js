import { isAbsolute, normalize, relative, resolve } from "node:path";
import { styleText } from "node:util";
import { run } from "./exec.js";
import { globToRegex } from "./glob.js";

/** Passed to function tasks so one config can serve different runners. */
const TASK_TYPE = "staged";

/** Matches a bare word, a quoted string, or a word with quoted parts, like a shell would. */
const ARGUMENT = /([^\s'"]([^\s'"]*(['"])([^\3]*?)\3)+[^\s'"]*)|[^\s'"]+|(['"])([^\5]*?)\5/g;

/**
 * The most characters that the files of one command call can use. These are half of the
 * argument limits of the operating systems, which leaves room for the environment.
 */
const MAX_ARG_LENGTH = ({ darwin: 262_144, win32: 8191 }[process.platform] ?? 131_072) / 2;

/** Thrown when one or more configured commands failed; the message is ready to print. */
export class CommandError extends Error {
  name = "CommandError";
}

/** Split a command line into arguments, honouring single and double quotes. */
export function splitCommand(command) {
  return Array.from(command.matchAll(ARGUMENT), (match) => match[1] ?? match[6] ?? match[0]);
}

/**
 * Split `files` into chunks so that the command line of each call stays below `maxLength`.
 * Each chunk has at least one file. `usedLength` is the length of the command and its arguments.
 * @param {string[]} files
 * @param {number} usedLength
 * @param {number} [maxLength]
 * @returns {string[][]}
 */
export function chunkFiles(files, usedLength, maxLength = MAX_ARG_LENGTH) {
  const chunks = [];
  let chunk = [];
  let length = usedLength;

  for (const file of files) {
    // One more character for the space between arguments.
    if (chunk.length && length + file.length + 1 > maxLength) {
      chunks.push(chunk);
      chunk = [];
      length = usedLength;
    }
    chunk.push(file);
    length += file.length + 1;
  }
  if (chunk.length) chunks.push(chunk);

  return chunks;
}

/**
 * Build one task group per configured glob pattern, holding a task per command.
 * Groups without matching files get no tasks.
 * @param {object} options
 * @param {Record<string, string | string[] | Function>} options.config
 * @param {string[]} options.files staged files, relative to `rootPath`
 * @param {string} options.cwd only files below this directory are matched
 * @param {string} options.rootPath the repository root, where commands run
 * @param {number} [options.maxArgLength] the most characters for the files of one call;
 * a command that would exceed it runs several times on parts of the files
 */
export async function createCommandGroups({
  config,
  files,
  cwd,
  rootPath,
  maxArgLength = MAX_ARG_LENGTH,
}) {
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
        // A function has already chosen the arguments; a plain command gets the files, as
        // many per call as fit in one command line.
        run: async (signal) => {
          if (isFunction) return run(command, args, { cwd: rootPath, signal });

          const used = [command, ...args].join(" ").length;
          for (const chunk of chunkFiles(matched, used, maxArgLength)) {
            await run(command, [...args, ...chunk], { cwd: rootPath, signal });
          }
        },
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
