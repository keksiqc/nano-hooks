import { isAbsolute, normalize, relative, resolve } from "node:path";
import { envWithBin, run } from "./exec.js";
import { createMatcher } from "./glob.js";

/**
/** Half the argument limit of the operating system, which leaves room for the environment. */
const MAX_ARG_LENGTH = ({ darwin: 262_144, win32: 8191 }[process.platform] ?? 131_072) / 2;

/**
// A task is `{ title, detail?, state?, tasks? }`. Only the runner below sets `state` (`run`,
// `done`, `fail`, `warn` for skipped, unset while it waits). The renderer only reads it.

/**
// A failure is `{ pattern, title, message }`: the group pattern, the command and its output.

/**
/** Thrown when commands fail. `failures` lists them, and the message is plain text. */
export class CommandError extends Error {
  name = "CommandError";

  constructor(failures) {
    super(
      failures
        .map(({ pattern, title, message }) => `${pattern} > ${title}:\n${message}`)
        .join("\n\n"),
    );
    this.failures = failures;
  }
}

/**
/**
 * Split `files` into chunks so that each call stays below `maxLength` characters, counting
 * `usedLength` for the command. A chunk has at least one file.
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
/**
 * Build a task group per glob pattern in `config`, with a task per command. `files` are
 * relative to `rootPath`, the repository root where commands run, and only those below `cwd`
 * match. A command that exceeds `maxArgLength` runs several times on parts of the files.
 */
export function createCommandGroups({
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
  const env = envWithBin(cwd);
  const groups = [];

  for (const [pattern, commands] of Object.entries(config)) {
    const matches = createMatcher(pattern);
    const matched = relativeFiles
      .filter((file) => {
        const outside = file.startsWith("..") || isAbsolute(file);
        return (pattern.startsWith("../") || !outside) && matches(file);
      })
      .map((file) => resolve(cwd, file));

    const lines = matched.length ? [].concat(commands) : [];
    const suffix = matched.length
      ? `${matched.length} ${matched.length > 1 ? "files" : "file"}`
      : "no files";

    const group = { title: pattern, detail: suffix, fileCount: matched.length };
    group.tasks = lines.map((line) => ({
      title: line,
      pattern,
      // A command runs in a shell and gets the files, as many per call as fit in one command line.
      run: async (signal) => {
        for (const chunk of chunkFiles(matched, line.length, maxArgLength)) {
          await run("sh", ["-c", `${line} "$@"`, "sh", ...chunk], { cwd: rootPath, env, signal });
        }
      },
    }));
    groups.push(group);
  }

  return groups;
}

/**
/** Run a group's commands in order and skip the rest after a failure. Returns the failures. */
async function runCommands(group, signal) {
  const failures = [];
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
      failures.push({ pattern: task.pattern, title: task.title, message: error.message.trim() });
    }
  }

  return failures;
}

/**
/**
 * Run the groups side by side, or one by one with `parallel: false` (do that when patterns can
 * match the same file and a command changes files). With `bail`, the first failure aborts the
 * rest. Throws a `CommandError` if any command failed.
 */
export async function runCommandGroups(groups, { bail = false, parallel = true } = {}) {
  const controller = bail ? new AbortController() : undefined;
  const failures = [];

  const runGroup = async (group) => {
    if (!group.fileCount || controller?.signal.aborted) {
      group.state = "warn";
      return;
    }

    group.state = "run";
    const failed = await runCommands(group, controller?.signal);
    if (failed.length) {
      group.state = "fail";
      failures.push(...failed);
      controller?.abort();
    } else {
      group.state = controller?.signal.aborted ? "warn" : "done";
    }
  };

  if (parallel) {
    await Promise.all(groups.map(runGroup));
  } else {
    for (const group of groups) await runGroup(group);
  }

  if (failures.length) throw new CommandError(failures);
}
