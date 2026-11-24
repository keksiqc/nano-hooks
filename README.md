<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <img alt="badge" src=".github/assets/banner-light.svg">
</picture>

# nano-hooks

[![version](https://shieldcn.dev/npm/nano-hooks.svg?variant=secondary)][npm-href]
[![downloads](https://shieldcn.dev/npm/dw/nano-hooks.svg?variant=secondary)][npm-href]
[![minzip](https://shieldcn.dev/bundlephobia/minzip/nano-hooks.svg?variant=secondary)][bundle-href]
[![license](https://shieldcn.dev/github/license/keksiqc/nano-hooks.svg?variant=secondary)][license-href]

nano-hooks is a small Git hooks manager. It has no dependencies and includes a runner for staged files.

## Quick start

nano-hooks requires Node 22, or Node 24 and later.

1. Install the package:

   ```sh
   pnpm add -D nano-hooks
   ```

2. Add a `prepare` script and a `nano-hooks` key to `package.json`:

   ```json
   {
     "scripts": { "prepare": "nano-hooks" },
     "nano-hooks": {
       "hooks": {
         "pre-commit": ["nano-hooks staged", "npm run typecheck"],
         "commit-msg": "node scripts/check-msg.js $1"
       },
       "staged": {
         "*.{js,ts}": "eslint --fix",
         "*.css": ["prettier --write"]
       }
     }
   }
   ```

3. Run `pnpm install`. The `prepare` script writes the hooks to your repository.

## Configuration

nano-hooks reads its configuration from one of these places, in this order: the `nano-hooks` key in `package.json`, the file `nano-hooks.config.json`, and the file `.nano-hooks.json`. All of them hold plain JSON. nano-hooks never runs your code to read the configuration. It looks only in the directory where you run it, unless you set `--config`. If more than one of these places exists, nano-hooks stops with an error that names them. Keep one.

The top-level configuration keys are `options`, `hooks`, and `staged`. The `hooks` key maps each Git hook name to a command or a list of commands.

- A command, such as `"commit-msg": "commitlint --edit \"$1\""`.
- A list of commands, such as `"pre-push": ["npm run lint", "npm test"]`. The commands run one after the other, and the first command that fails stops the list.

A hook is never an object, and nano-hooks adds no step to a hook. To run the `staged` step in a hook, write the command `nano-hooks staged` in it.

```json
{
  "nano-hooks": {
    "options": { "bail": true, "preserveUnused": ["post-merge"] },
    "hooks": {
      "pre-commit": ["nano-hooks staged", "npm run typecheck", "npm test"],
      "commit-msg": "commitlint --edit \"$1\"",
      "pre-push": ["npm run lint", "npm test"]
    },
    "staged": {
      "*.{js,ts,tsx}": ["oxlint --fix", "prettier --write"],
      "*.json": "prettier --write"
    }
  }
}
```

The `staged` key maps a glob pattern to a command or to a list of commands. This is the nano-staged format. Patterns support `*`, `**`, `?`, `[abc]`, `[!a-z]` and `{a,b}`. A pattern without a slash matches the file name at any depth. Groups like `!(a)` and `+(a|b)` are not supported. Use braces instead. The command `nano-hooks staged` runs these commands on the staged files. If one of them fails, the commit stops, and the commands after `nano-hooks staged` in the hook do not run.

These keys of `options` control the `staged` step. A command line option of `nano-hooks staged` wins over `options`.

| Key          | Default | Description                                                                                           |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| `parallel`   | `true`  | Run the `staged` patterns side by side. If two patterns can match the same file, set it to `false`.   |
| `bail`       | `false` | Stop the `staged` step after the first command that fails. Same as `--bail`.                          |
| `allowEmpty` | `false` | Allow a commit that is empty after the `staged` commands ran. Same as `--allow-empty`.                |
| `restage`    | `true`  | Add the changes that the `staged` commands made to the commit. If `false`, the changes stay unstaged. |

The `options` section accepts one more key. `preserveUnused` is `true`, or a list of hook names. It keeps hooks that nano-hooks wrote earlier but that are no longer in the configuration.

If the configuration has a mistake, nano-hooks rejects it and lists every problem with the file name and key. A misspelled hook produces an error such as `hooks.pre-comit: unknown git hook "pre-comit"`.

For editor completion and validation, add `"$schema": "./node_modules/nano-hooks/schema.json"` to a standalone configuration file in your project root. The schema also describes the value of the `nano-hooks` key in `package.json`. nano-hooks checks staged glob syntax when it loads the configuration. [JSON Schema](./schema.json)

Git starts every hook in the root of the repository, and nano-hooks runs your commands there. `nano-hooks staged` reads the configuration from the directory where it runs. If the configuration is in a subdirectory, set `hooks.pre-commit` to a command such as `cd packages/app && nano-hooks staged`. If the configuration file has another name, write `nano-hooks staged --config <path>` in the hook.

### Upgrading from 0.6

Move each top-level Git hook into `hooks`. If a hook uses the 0.6 object form, move its staged patterns to `staged`, move its settings to `options`, and use `nano-hooks staged` in the hook's command list. A 0.6 configuration could look like this.

```json
{
  "pre-commit": { "staged": { "*.js": "eslint --fix" }, "run": "npm test", "bail": true }
}
```

The equivalent configuration uses all three sections.

```json
{
  "options": { "bail": true },
  "hooks": { "pre-commit": ["nano-hooks staged", "npm test"] },
  "staged": { "*.js": "eslint --fix" }
}
```

Include any needed `cd` or `--config` in the hook command itself. After you change the configuration, run `nano-hooks install` again.

### Commands in hooks and in `staged`

In a hook, every command runs in a `sh` shell, gets the hook arguments as `$1`, `$2`, and so on, and the exit code of the failing command is the exit code of the hook. In `staged`, every command gets the staged files that match the pattern, and the rest of the list is skipped after a failure. A `staged` command also runs in a `sh` shell, and nano-hooks adds the files to the end of the command line. Shell features such as `$VAR` and `A=1 cmd` work. An operator such as `&&` or `|` splits the line, so the files go to the last command only. To send the files to another command, write `sh -c '...' sh` as the command.

### Behavior

- Hook scripts add `node_modules/.bin` to `PATH`, so locally installed tools work without a path.
- To skip all hooks for one command, set `SKIP_NANO_HOOKS=1`. For example: `SKIP_NANO_HOOKS=1 git commit`.
- To skip the installation, set `NANO_HOOKS=0`. For example: `NANO_HOOKS=0 pnpm install`. Use it in CI or in a container build where you do not need hooks.
- If the directory is not a git repository, `install` prints a warning and exits with code 0. A `prepare` script then does not fail an install that has no `.git` directory.
- nano-hooks never overwrites or removes a hook that it did not write. The `install` command reports these hooks and continues.
- If `core.hooksPath` points outside `.git`, `install` writes the hooks to that directory. If the directory also holds files that nano-hooks did not write, `install` prints a warning, because another tool such as husky can manage it. Make sure that only one tool manages the directory.
- If a hook that nano-hooks wrote earlier is no longer configured, nano-hooks removes it. To keep it, set `options.preserveUnused` to `true` or list the hook name.

## CLI

| Command                              | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `nano-hooks` or `nano-hooks install` | Write the configured hooks.                      |
| `nano-hooks uninstall`               | Remove the hooks that nano-hooks manages.        |
| `nano-hooks staged`                  | Run the commands of the `staged` key.            |
| `nano-hooks run <hook>`              | Run one configured hook now, with all its steps. |

| Option                | Applies to    | Description                                                    |
| --------------------- | ------------- | -------------------------------------------------------------- |
| `-c, --config <path>` | Every command | Use this JSON configuration file instead of searching for one. |
| `-v, --version`       | Every command | Print the version and exit.                                    |
| `-h, --help`          | Every command | Print the help and exit.                                       |
| `--allow-empty`       | `staged`      | Allow a commit that is empty after the commands ran.           |
| `--bail`              | `staged`      | Stop after the first command that fails.                       |
| `--no-parallel`       | `staged`      | Run the patterns one after the other.                          |
| `--no-restage`        | `staged`      | Leave the changes of the commands out of the commit.           |

The `--config` option accepts a `.json` file or a `package.json` file. For a `package.json` file, nano-hooks reads the `nano-hooks` key. nano-hooks resolves a relative path from the directory where you run the command. A file with another extension, such as `.js`, is an error.

The `uninstall` command does not read the configuration. It accepts `--config` but ignores it.

The hook script holds your commands as you wrote them. The `install` command adds no `cd`, no flag and no variable. The script changes only when you run `install`, so run it again after you change a hook. The `staged` step reads the configuration each time it runs, so a change to `staged` or to `options` takes effect at once. The hook scripts contain no absolute paths, so they keep working when you move the repository. They find `nano-hooks` in `node_modules/.bin` of the project.

The `run` command runs the commands of the named hook now. For example, `nano-hooks run pre-push` runs the `pre-push` command from your configuration. If the hook calls `nano-hooks staged`, the `staged` step runs as it does in a real commit. The commands go to a `sh` shell in the directory where you run the command. The exit code of the failing command becomes the exit code of `run`. The `run` command does not need the hook to be installed, and it ignores `SKIP_NANO_HOOKS`.

The `staged` command runs the commands of the `staged` key. A hook calls it. You can also run it by hand to test your patterns.

## Staged files

The `staged` command comes from [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov. nano-hooks is not affiliated with nano-staged. See [Credits](#credits).

To move from nano-staged, copy your nano-staged configuration into the top-level `staged` key, and add `nano-hooks staged` to `hooks.pre-commit`. nano-hooks reads only JSON, so a nano-staged function task must become a command. nano-hooks does not read `.nano-staged.*` files or the `nano-staged` key. It runs only on staged files, so it does not include the `--diff` and `--unstaged` modes of nano-staged.

If the file list is too long for one command line, nano-hooks runs the command several times, each time on a part of the files.

When the commands run, nano-hooks sets aside the unstaged changes in partially staged files. It adds formatter changes back to the commit. If you set `restage` to `false`, it leaves these changes in the working tree instead. For a partially staged file, this can cause a merge conflict when nano-hooks restores your unstaged changes. If a command fails, nano-hooks restores the original Git index and the tracked files it backed up.

During a run, nano-hooks saves the index as `nano-hooks.index` in the Git directory. It saves the original unstaged changes in `nano-hooks.patch` and the hidden changes from partially staged files in `nano-hooks_partial.patch`. It deletes these files after a successful run or rollback. If recovery fails, nano-hooks keeps the files and prints their paths. Use `GIT_INDEX_FILE=/path/to/nano-hooks.index git diff --cached` to inspect the original staged changes. The patch files can be applied with `git apply --unidiff-zero` to the corresponding file versions. Once you have recovered your changes, delete the recovery files so `nano-hooks staged` can run again.

## Benchmarks

These numbers compare `nano-hooks staged` with `lint-staged` and `nano-staged`. Each runner runs `prettier --write` on 10 staged files, five `.js` files and five `.css` files.

```diff
$ node bench/running-time/index.js
Median of 20 runs, 10 staged files
- lint-staged   223 ms
- nano-staged   201 ms
+ nano-hooks    172 ms
```

The size of `node_modules` after an `npm install` of the runner alone, with all sub-dependencies:

```diff
$ node bench/size/index.js
Size of node_modules after npm install
- lint-staged   962 kB
- nano-staged    52 kB
+ nano-hooks     66 kB
```

The running time includes the time that `prettier` needs, so the difference between the runners is the overhead of the runner. nano-hooks is 14 kB larger than nano-staged because it also installs hooks, runs hook commands, and ships this README. The runs used Node 26 on Linux (WSL2) and the lint-staged and nano-staged versions on npm on 2026-11-10. Your numbers will differ.

To run the benchmarks, run `pnpm bench`. The running-time benchmark installs the runners into a temporary Git repository, so it needs network access. The `nano-hooks` entry is this checkout, packed the way `npm publish` packs it. The benchmarks are adapted from [nano-staged](https://github.com/usmanyunusov/nano-staged/tree/master/bench).

## Development

This project uses JavaScript modules, pnpm, oxlint, oxfmt, and vitest. It has no build step. The package exports `src/index.js` directly.

```sh
pnpm install
pnpm lint
pnpm fmt
pnpm test
```

The `pnpm install` command runs `prepare`, which installs the pre-commit hook of this repository. The `pre-commit` hook runs `nano-hooks staged`, which formats staged files with `pnpm run fmt` and lints staged JavaScript files with `pnpm run lint`.

CI uses the Unit Test workflow from [`sxzz/workflows`](https://github.com/sxzz/workflows). The file is `.github/workflows/ci.yml`. It runs on each push and pull request to `main`. It runs `pnpm run lint` once on Linux. It runs `pnpm run test` on Ubuntu and Windows with Node 22, 24, and 26. CI does not check formatting, so run `pnpm fmt` before you push.

### Release a version

1. Make sure that CI passes on `main`. The release workflow does not run lint or tests.
2. Update the version in `package.json` and commit the change.
3. Push a tag that matches the version, for example `v0.1.1`.

The release workflow is `.github/workflows/release.yml`, also from `sxzz/workflows`. It creates a GitHub release with notes from the Conventional Commit messages. Then it runs `pnpm -r publish --access public --no-git-checks`.

## Credits

The staged-file runner is adapted from [nano-staged](https://github.com/usmanyunusov/nano-staged), © Usman Yunusov, under the MIT License. nano-hooks restructured and changed the code. Report bugs in the runner to this repository, not to nano-staged.

## License

[MIT](./LICENSE) License © [Keksi](https://github.com/keksiqc)

<!-- Badges -->

[npm-href]: https://npmx.dev/package/nano-hooks
[bundle-href]: https://bundlephobia.com/result?p=nano-hooks
[license-href]: https://github.com/keksiqc/nano-hooks/blob/main/LICENSE
