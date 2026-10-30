// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
import { realpathSync } from "node:fs";
import { getConfig, validConfig } from "./config.js";
import { createReporter } from "./reporter.js";
import { NanoStagedError } from "./errors.js";
import { createRunner } from "./runner.js";
import { createGit } from "./git.js";
import { toArray } from "./utils.js";

// Git reports canonical paths (symlinks and Windows 8.3 short names resolved), and
// file matching compares them with cwd, so cwd has to be canonical too.
function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

export async function runStaged(options) {
  const opts = {
    stream: process.stderr,
    cwd: process.cwd(),
    allowEmpty: false,
    config: undefined,
    quiet: false,
    bail: false,
    ...options,
  };
  opts.cwd = canonical(opts.cwd);

  const reporter = createReporter(opts.stream);
  const git = createGit(opts.cwd);

  try {
    const config = await getConfig(opts.config);
    const git_paths = await git.getGitPaths();

    if (!config) {
      if (typeof opts.config === "string") {
        throw new NanoStagedError("noFileConfig", opts.config);
      } else {
        throw new NanoStagedError("noConfig");
      }
    }

    if (!validConfig(config)) {
      throw new NanoStagedError("invalidConfig");
    }

    if (!git_paths.root) {
      throw new NanoStagedError("noGitRepo");
    }

    const files = await git.stagedFiles({ cwd: git_paths.root });

    if (!files.working.length) {
      reporter.error(new NanoStagedError("noFiles", "staged"));
      return;
    }

    await createRunner({ ...opts, config, git_paths, files }).run();
  } catch (errors) {
    for (const error of toArray(errors)) {
      reporter.error(error);
    }
    throw errors;
  }
}
