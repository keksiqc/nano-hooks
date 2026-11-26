import { EmptyCommitError } from "../lib/backup.js";
import { loadConfig, resolveSettings } from "../lib/config.js";
import { log } from "../lib/log.js";
import { runStagedTasks } from "../lib/staged.js";
import { CommandError } from "../lib/tasks.js";

const ALLOW_EMPTY_FLAG = "--allow-empty";

export function registerStagedCommand(cli) {
  return cli
    .command("staged", 'Run the commands of the "staged" key')
    .ignoreOptionDefaultValue()
    .option(ALLOW_EMPTY_FLAG, "Allow empty commits")
    .option("--bail", "Stop after the first failing command")
    .option("--no-parallel", "Run the patterns one after the other")
    .option("--no-restage", "Leave the changes of the commands out of the commit")
    .action(({ config: file, ...flags }) => runConfiguredStaged({ file, flags }));
}

function advise(error) {
  return error instanceof EmptyCommitError
    ? new Error(`${error.message} Use ${ALLOW_EMPTY_FLAG} to allow it.`, { cause: error })
    : error;
}

function report(error, stream) {
  if (error instanceof CommandError) log.failures(error.failures, stream);
  else log.error(error?.message ?? String(error), stream);
}

/**
 * Run the commands of `config` (glob pattern to command or list of commands) on the staged
 * files below `cwd`. Failures go to `stream` and are rethrown, as an `AggregateError` when
 * several steps failed. `allowEmpty`, `bail`, `parallel` and `restage` are the settings of
 * `staged`, and `quiet` hides the progress.
 */
export async function runStaged({
  config,
  cwd = process.cwd(),
  quiet = false,
  stream = process.stderr,
  ...settings
} = {}) {
  try {
    await runStagedTasks({ config, cwd, stream, quiet, settings });
  } catch (error) {
    const causes = (error instanceof AggregateError ? error.errors : [error]).map((cause) =>
      advise(cause),
    );
    for (const cause of causes) report(cause, stream);
    throw error instanceof AggregateError ? new AggregateError(causes, error.message) : causes[0];
  }
}

/**
 * Run the commands of the top-level `staged` key of the configuration in `cwd`, or in `file`.
 * A setting comes from `flags`, then the `options` of the configuration. A configuration that
 * cannot be loaded rejects. Returns the exit code.
 */
export async function runConfiguredStaged({ file, flags = {}, cwd = process.cwd() }) {
  const loaded = await loadConfig(cwd, { file });
  const settings = resolveSettings(loaded.options, flags);
  process.on("SIGINT", () => {});
  try {
    await runStaged({ config: loaded.staged, cwd, ...settings });
  } catch {
    return 1;
  }
  return 0;
}
