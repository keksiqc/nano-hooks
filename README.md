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
         "commit-msg": "node scripts/check-msg.js $1"
       },
       "staged": {
         "*.{js,ts}": "eslint --fix",
         "*.css": ["prettier --write"]
       },
       "options": {
         "concurrent": false,
         "preserveUnused": ["pre-push"]
       }
     }
   }
   ```

3. Run `pnpm install`. The `prepare` script writes the hooks to your repository.

## Configuration

nano-hooks reads its configuration from the first of these places that exists, in this order: `.nano-hooks.json`, `.nano-hooks.js`, `.nano-hooks.mjs`, and the `nano-hooks` key in `package.json`. A dedicated file wins over `package.json`. nano-hooks looks only in the directory where you run it, unless you set `--config`.

All sections are optional:

| Section          | Description                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks`          | Maps a Git hook name to the shell command that it runs.                                                                               |
| `staged`         | Maps a glob pattern to a command, a list of commands, or (in a JS file) a function that returns them. This is the nano-staged format. |
| `options`        | Settings for nano-hooks. See the table below.                                                                                         |
| `preserveUnused` | The older form of `options.preserveUnused`. nano-hooks uses it only when `options.preserveUnused` is not set.                         |

The `options` section accepts these keys:

| Option           | Default | Description                                                                                                   |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `concurrent`     | `true`  | Run the `staged` patterns side by side. If two patterns can match the same file, set it to `false`.           |
| `bail`           | `false` | Stop the `staged` run after the first command that fails. Same as `--bail`.                                   |
| `allowEmpty`     | `false` | Allow a commit that is empty after the `staged` tasks ran. Same as `--allow-empty`.                           |
| `preserveUnused` | `false` | `true`, or a list of hook names. Keeps hooks that nano-hooks wrote earlier but that are no longer in `hooks`. |

A command line option wins over the same option in the configuration.

If the configuration has a mistake, nano-hooks rejects it and lists every problem with the file name and the key. For example: `hooks.pre-comit: unknown git hook`.

### Behavior

- If `staged` is set and `hooks` has no `pre-commit`, the `pre-commit` hook runs the staged runner. To run other commands too, define `pre-commit` yourself: `"pre-commit": "nano-hooks staged && pnpm test"`.
- Hook scripts add `node_modules/.bin` to `PATH`, so locally installed tools work without a path.
- To skip all hooks for one command, set `SKIP_NANO_HOOKS=1`. For example: `SKIP_NANO_HOOKS=1 git commit`.
- To skip the installation, set `NANO_HOOKS=0`. For example: `NANO_HOOKS=0 pnpm install`. Use it in CI or in a container build where you do not need hooks.
- If the directory is not a git repository, `install` prints a warning and exits with code 0. A `prepare` script then does not fail an install that has no `.git` directory.
- nano-hooks never overwrites or removes a hook that it did not write. The `install` command reports these hooks and continues.
- If `core.hooksPath` points outside `.git`, `install` writes the hooks to that directory and prints a warning. Tools such as husky set this option, so make sure that only one tool manages the directory.
- If a hook that nano-hooks wrote earlier is no longer configured, nano-hooks removes it. To keep it, set `options.preserveUnused` to `true` or list the hook name.

## CLI

| Command                              | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `nano-hooks` or `nano-hooks install` | Write the configured hooks.                 |
| `nano-hooks uninstall`               | Remove the hooks that nano-hooks manages.   |
| `nano-hooks staged`                  | Run the `staged` tasks on the staged files. |
| `nano-hooks run <hook> [args...]`    | Run the command of one configured hook now. |

| Option                | Applies to    | Description                                               |
| --------------------- | ------------- | --------------------------------------------------------- |
| `-c, --config <path>` | Every command | Use this configuration file instead of searching for one. |
| `-v, --version`       | Every command | Print the version and exit.                               |
| `--allow-empty`       | `staged`      | Allow a commit that is empty after the tasks ran.         |
| `--bail`              | `staged`      | Stop after the first command that fails.                  |
| `--no-concurrent`     | `staged`      | Run the patterns one after the other.                     |

The `--config` option accepts a `.json`, `.js`, or `.mjs` file, or a `package.json` file. For a `package.json` file, nano-hooks reads the `nano-hooks` key. nano-hooks resolves a relative path from the directory where you run the command.

The `uninstall` command does not read the configuration. It accepts `--config` but ignores it.

If you run `nano-hooks install --config <path>`, the generated `pre-commit` hook runs `nano-hooks staged --config <path>`. The hook scripts contain no absolute paths, so they keep working when you move the repository. They find `nano-hooks` in `node_modules/.bin` of the project. If you write your own `pre-commit` command, you must pass `--config` in that command.

The `run` command runs the command of the named hook in a `sh` shell. For example, `nano-hooks run pre-push` runs the `pre-push` command from your configuration. Arguments after the hook name go to the command as `$1`, `$2`, and so on. Put `--config` before the hook name. The exit code of the command becomes the exit code of `run`. If you set `staged` but not `pre-commit`, `nano-hooks run pre-commit` runs the staged runner. The `run` command does not need the hook to be installed, and it ignores `SKIP_NANO_HOOKS`.

## Staged files

The `staged` command comes from [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov. nano-hooks is not affiliated with nano-staged. See [Credits](#credits).

To move from nano-staged, copy your nano-staged configuration into the `staged` section. nano-hooks does not read `.nano-staged.*` files or the `nano-staged` key. It runs only on staged files, so it does not include the `--diff` and `--unstaged` modes of nano-staged.

If the file list is too long for one command line, nano-hooks runs the command several times, each time on a part of the files. A function task gets all files in one call and must split them itself.

When the commands run, nano-hooks sets aside the unstaged changes in partially staged files. It adds formatter changes back to the commit. If a command fails, it rolls back all changes.

## Development

This project uses JavaScript modules, pnpm, oxlint, oxfmt, and vitest. It has no build step. The package exports `src/index.js` directly.

```sh
pnpm install
pnpm lint
pnpm fmt
pnpm test
```

The `pnpm install` command runs `prepare`, which installs the pre-commit hook of this repository. The hook runs `nano-hooks staged`. This command formats staged files with `pnpm run fmt` and lints staged JavaScript files with `pnpm run lint`.

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
