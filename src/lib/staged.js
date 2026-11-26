import { runWithBackup } from "./backup.js";
import { resolveSettings } from "./config.js";
import { createGit } from "./git.js";
import { createRenderer, log } from "./log.js";
import { realPath } from "./paths.js";
import { createCommandGroups, runCommandGroups } from "./tasks.js";

export async function runStagedTasks({ config, cwd, stream, quiet, settings }) {
  if (!config) {
    throw new Error(
      'No staged tasks configured. Add a "staged" key to your nano-hooks configuration.',
    );
  }

  const projectDir = realPath(cwd);
  const { root, gitDir } = await createGit(projectDir).getGitPaths();
  if (!root) throw new Error("Not a git repository.");

  const git = createGit(root);
  const { working, changed, deleted } = await git.stagedFiles();
  if (working.length === 0) {
    log.info("No staged files found.", stream);
    return;
  }

  const groups = createCommandGroups({ config, files: working, cwd: projectDir, rootPath: root });
  if (!groups.some((group) => group.fileCount > 0)) {
    log.info("No files match any configured task.", stream);
    return;
  }

  const { allowEmpty, bail, parallel, restage } = resolveSettings(settings);
  const renderer = createRenderer(stream, {
    isTTY: Boolean(stream.isTTY) && !process.env.CI,
    quiet,
  });
  try {
    // Patterns match relative to cwd. Git protects and restages staged paths across the repo.
    await runWithBackup({
      git,
      gitDir,
      hidePaths: [...changed, ...deleted],
      restagePaths: restage ? working : undefined,
      allowEmpty,
      execute: { tasks: groups, run: () => runCommandGroups(groups, { bail, parallel }) },
      onStep: (step) => renderer.start(step),
    });
  } finally {
    renderer.stop();
  }
}
