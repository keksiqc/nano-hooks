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
       "pre-commit": {
         "staged": {
           "*.{js,ts}": "eslint --fix",
           "*.css": ["prettier --write"]
         },
         "run": "npm run typecheck"
       },
       "commit-msg": "node scripts/check-msg.js $1"
     }
   }
   ```

3. Run `pnpm install`. The `prepare` script writes the hooks to your repository.

To get a starter configuration without editing `package.json` yourself, run `pnpm exec nano-hooks init` after step 1. See [`init`](#cli).

## Configuration

nano-hooks reads its configuration from one of these places, in this order: the `nano-hooks` key in `package.json`, the file `nano-hooks.config.json`, and the file `.nano-hooks.json`. All of them hold plain JSON. nano-hooks never runs your code to read the configuration. It looks only in the directory where you run it, unless you set `--config`. If more than one of these places exists, nano-hooks stops with an error that names them. Keep one.

The keys of the configuration are the names of Git hooks, and the key `options`. Each hook is one of three things:

- A command, such as `"commit-msg": "commitlint --edit \"$1\""`.
- A list of commands, such as `"pre-push": ["npm run lint", "npm test"]`. The commands run one after the other, and the first command that fails stops the list.
- An object with the keys `run` and `staged`, and the settings in the table below. At least one of `run` and `staged` is required.

```json
{
  "nano-hooks": {
    "options": { "bail": true, "preserveUnused": ["post-merge"] },
    "pre-commit": {
      "staged": {
        "*.{js,ts,tsx}": ["oxlint --fix", "prettier --write"],
        "*.json": "prettier --write"
      },
      "run": ["npm run typecheck", "npm test"],
      "restage": true,
      "parallel": false
    },
    "commit-msg": "commitlint --edit \"$1\"",
    "pre-push": ["npm run lint", "npm test"]
  }
}
```

The `pre-commit` hook is the only hook that accepts `staged` and the settings. `staged` maps a glob pattern to a command or to a list of commands. This is the nano-staged format. Patterns support `*`, `**`, `?`, `[abc]`, `[!a-z]` and `{a,b}`. A pattern without a slash matches the file name at any depth. Groups like `!(a)` and `+(a|b)` are not supported; use braces instead. When the hook runs, the `staged` step runs first and the `run` commands run second. If the `staged` step fails, the `run` commands do not run.

These settings control the `staged` step. Set them in the `pre-commit` object for one hook, or in `options` for the whole configuration. The value in the hook wins over the value in `options`, and a command line option wins over both.

| Setting      | Default | Description                                                                                           |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------- |
| `parallel`   | `true`  | Run the `staged` patterns side by side. If two patterns can match the same file, set it to `false`.   |
| `bail`       | `false` | Stop the `staged` step after the first command that fails. Same as `--bail`.                          |
| `allowEmpty` | `false` | Allow a commit that is empty after the `staged` commands ran. Same as `--allow-empty`.                |
| `restage`    | `true`  | Add the changes that the `staged` commands made to the commit. If `false`, the changes stay unstaged. |

The `options` section accepts one more key. `preserveUnused` is `true`, or a list of hook names. It keeps hooks that nano-hooks wrote earlier but that are no longer in the configuration.

If the configuration has a mistake, nano-hooks rejects it and lists every problem with the file name and the key. For example: `pre-comit: unknown key (expected a git hook name or options)`.

If you used nano-hooks 0.4 or earlier, read [MIGRATION.md](./MIGRATION.md).

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

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `nano-hooks init [command]`          | Add a starter configuration and install it.          |
| `nano-hooks` or `nano-hooks install` | Write the configured hooks.                          |
| `nano-hooks uninstall`               | Remove the hooks that nano-hooks manages.            |
| `nano-hooks staged`                  | Run the `staged` step of the `pre-commit` hook only. |
| `nano-hooks run <hook> [args...]`    | Run one configured hook now, with all its steps.     |

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

The `init` command adds a `nano-hooks` key to `package.json` with a `pre-commit` hook that runs `command`. For example, `nano-hooks init pnpm run lint`. If you give no command, it uses `<package manager> run lint`. It takes the package manager from the `packageManager` field, or else from the lock file, or else it uses `npm`. Everything after `init` is the command, so options such as `--fix` go to the command and `--config` must come before `init`. The command also adds a `prepare` script that runs `nano-hooks`, or appends `&& nano-hooks` to your own `prepare` script. Then it installs the hooks. If nano-hooks is already configured, `init` stops and changes nothing. It always writes to `package.json` and ignores `--config`.

The `uninstall` command does not read the configuration. It accepts `--config` but ignores it.

The hook script holds your `run` commands as you wrote them. If the hook has a `staged` key, the script first calls `nano-hooks staged`. If you run `nano-hooks install --config <path>`, that call becomes `nano-hooks staged --config <path>`. The script changes only when you run `install`, so run it again after you change a `run` command. The `staged` step reads the configuration each time it runs, so a change to `staged` or to a setting takes effect at once. The hook scripts contain no absolute paths, so they keep working when you move the repository. They find `nano-hooks` in `node_modules/.bin` of the project.

The `run` command runs all steps of the named hook now. For a `pre-commit` object, it runs the `staged` step and then the `run` commands. The `run` commands go to a `sh` shell. For example, `nano-hooks run pre-push` runs the `pre-push` command from your configuration. Arguments after the hook name go to the commands as `$1`, `$2`, and so on. Put `--config` before the hook name. The exit code of the failing step or command becomes the exit code of `run`. The `run` command does not need the hook to be installed, and it ignores `SKIP_NANO_HOOKS`.

The `staged` command runs only the `staged` step of the `pre-commit` hook, and not the `run` commands. Use it if you write your own Git hook, for example with another hook manager, or to test your patterns by hand.

## Staged files

The `staged` command comes from [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov. nano-hooks is not affiliated with nano-staged. See [Credits](#credits).

To move from nano-staged, copy your nano-staged configuration into the `staged` key of the `pre-commit` hook. nano-hooks reads only JSON, so a nano-staged function task must become a command. nano-hooks does not read `.nano-staged.*` files or the `nano-staged` key. It runs only on staged files, so it does not include the `--diff` and `--unstaged` modes of nano-staged.

If the file list is too long for one command line, nano-hooks runs the command several times, each time on a part of the files.

When the commands run, nano-hooks sets aside the unstaged changes in partially staged files. It adds formatter changes back to the commit. If you set `restage` to `false`, it leaves these changes in the working tree instead. For a partially staged file, this can cause a merge conflict when nano-hooks restores your unstaged changes. If a command fails, it rolls back all changes.

During a run, nano-hooks saves your changes in two patch files in the Git directory: `nano-hooks.patch` and `nano-hooks_partial.patch`. It deletes them when the run succeeds or when a rollback succeeds. If a rollback or the restoration of your unstaged changes fails, for example because of a merge conflict, nano-hooks keeps the patch files and prints their paths. Run `git apply --unidiff-zero` on a patch file to get your changes back, then delete both files. While these files exist, `nano-hooks staged` stops before it changes anything and prints their paths.

## Development

This project uses JavaScript modules, pnpm, oxlint, oxfmt, and vitest. It has no build step. The package exports `src/index.js` directly.

```sh
pnpm install
pnpm lint
pnpm fmt
pnpm test
```

The `pnpm install` command runs `prepare`, which installs the pre-commit hook of this repository. The hook runs `nano-hooks staged`, which formats staged files with `pnpm run fmt` and lints staged JavaScript files with `pnpm run lint`. Then it runs `pnpm run test`. The `pre-push` hook also runs `pnpm run test`.

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
