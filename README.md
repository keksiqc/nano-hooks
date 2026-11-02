# nano-hooks

<a href="https://npmx.dev/package/nano-hooks">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/npm/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=dark">
    <img alt="npm Version" src="https://www.shieldcn.dev/npm/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=light">
  </picture>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/npm/dw/nano-hooks.svg?variant=secondary&size=sm&amp;mode=dark">
    <img alt="npm Weekly Downloads" src="https://www.shieldcn.dev/npm/dw/nano-hooks.svg?variant=secondary&size=sm&amp;mode=light">
  </picture>
</a>
<a href="https://github.com/keksiqc/nano-hooks/actions/workflows/ci.yml">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/ci/keksiqc/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=dark">
    <img alt="CI" src="https://www.shieldcn.dev/github/ci/keksiqc/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=light">
  </picture>
</a>
<a href="https://github.com/keksiqc/nano-hooks/blob/main/LICENSE">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/license/keksiqc/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=dark">
    <img alt="License" src="https://www.shieldcn.dev/github/license/keksiqc/nano-hooks.svg?variant=secondary&amp;size=sm&amp;mode=light">
  </picture>
</a>

A tiny Git hooks manager with zero dependencies and a built-in staged-file runner.

## Usage

```sh
pnpm add -D nano-hooks
```

Configure everything in one place: the `nano-hooks` key in `package.json`, or `.nano-hooks.json`, `.nano-hooks.js` or `.nano-hooks.mjs`. Install the hooks from a `prepare` script:

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
    "preserveUnused": ["pre-push"]
  }
}
```

| Section          | Description                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks`          | Git hook name mapped to the shell command it runs.                                                                                        |
| `staged`         | Glob pattern mapped to a command, a list of commands, or (in a JS config) a function returning them. This is the format nano-staged uses. |
| `preserveUnused` | `true`, or a list of hook names, to keep hooks that nano-hooks wrote earlier but that are no longer in `hooks`.                           |

All three sections are optional. A config with a mistake is rejected with every problem listed, naming the file and the key, for example `hooks.pre-comit: unknown git hook`.

When `staged` is set and `hooks` has no `pre-commit`, `pre-commit` runs the staged runner automatically. To run it alongside other commands, define `pre-commit` yourself, for example `"pre-commit": "nano-hooks staged && pnpm test"`.

Hook scripts put `node_modules/.bin` on `PATH`, so locally installed tools just work. Set `SKIP_NANO_HOOKS=1` to skip every hook for one command, for example `SKIP_NANO_HOOKS=1 git commit`.

Hooks that already exist and were not written by nano-hooks are never overwritten or removed. `install` reports them and moves on. Hooks that nano-hooks wrote earlier but are no longer configured are removed, unless `preserveUnused` is `true` or lists their names.

### CLI

| Command                              | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `nano-hooks` or `nano-hooks install` | Write the configured hooks.                 |
| `nano-hooks uninstall`               | Remove the hooks nano-hooks manages.        |
| `nano-hooks staged`                  | Run the `staged` tasks on the staged files. |

| Option                | Applies to    | Description                                                 |
| --------------------- | ------------- | ----------------------------------------------------------- |
| `-c, --config <path>` | every command | Use this nano-hooks config file instead of looking for one. |
| `--allow-empty`       | `staged`      | Allow a commit that ends up empty after the tasks ran.      |
| `--bail`              | `staged`      | Stop after the first failing command.                       |

`--config` takes a `.json`, `.js` or `.mjs` file, or a `package.json` (which is read from its `nano-hooks` key). Relative paths are resolved from the directory you run the command in. `uninstall` removes whatever nano-hooks wrote and does not read the config, so it accepts the option but ignores it.

When you run `nano-hooks install --config <path>`, the generated `pre-commit` hook runs `staged` with that same file. A `pre-commit` command you write yourself, such as `"nano-hooks staged && pnpm test"`, has to pass `--config` itself if it should use the file.

## Staged files

The `staged` command is derived from [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov, and is not affiliated with it. See [Credits](#credits).

The `staged` section uses nano-staged's task format, so to move over from nano-staged, copy your config under `staged` in the nano-hooks config. nano-hooks does not read `.nano-staged.*` files or the `nano-staged` key, and it only runs on staged files: nano-staged's `--diff` and `--unstaged` modes are not included.

Unstaged changes to partially staged files are set aside while the commands run, formatter changes are added back to the commit, and everything is rolled back if a command fails.

## Development

This project uses JavaScript modules, pnpm, oxlint, oxfmt and vitest. No build step is required; the package exports `src/index.js` directly.

```sh
pnpm install
pnpm lint
pnpm fmt
pnpm test
```

`pnpm install` runs `prepare`, which installs this repository's own pre-commit hook. It runs `nano-hooks staged`, which formats staged files with `pnpm run fmt` and lints staged JavaScript with `pnpm run lint`.

CI is the shared [`sxzz/workflows`](https://github.com/sxzz/workflows) Unit Test workflow (`.github/workflows/ci.yml`). It runs on pushes and pull requests to `main`: `pnpm run lint` once on Linux, and `pnpm run test` on Ubuntu and Windows with Node 22, 24 and 26. CI does not check formatting, so run `pnpm fmt` before you push.

## Note for Developers

To publish the package for the first time, authenticate with npm and run `pnpm publish --access public` locally. npm only lets you configure a trusted publisher for a package that already exists, so this first publish has to be manual.

After that, add a trusted publisher for the package on npm: provider GitHub Actions, repository `keksiqc/nano-hooks`, workflow `release.yml`. The release workflow publishes through npm's trusted publishing (OIDC, `id-token: write`), so no `NPM_TOKEN` secret is needed.

To release, update the version in `package.json`, commit the change, then push a matching `v*` tag, for example `v0.1.1`. The release workflow (`.github/workflows/release.yml`, also from `sxzz/workflows`) creates a GitHub release with notes generated from the Conventional Commit messages and publishes with `pnpm -r publish --access public --no-git-checks`. It does not run lint or tests, so make sure CI is green on `main` before you tag.

## Credits

The staged-file runner is adapted from [nano-staged](https://github.com/usmanyunusov/nano-staged), © Usman Yunusov, used under the MIT License. It has been restructured and changed to fit nano-hooks, so any bugs in it are nano-hooks' own and should be reported here, not upstream.

## License

[MIT](./LICENSE) License © [Keksi](https://github.com/keksiqc)

<!-- Badges -->

[npm-href]: https://npmx.dev/package/nano-hooks
[bundle-src]: https://img.shields.io/bundlephobia/minzip/nano-hooks?style=for-the-badge&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=nano-hooks
[license-src]: https://img.shields.io/github/license/keksiqc/nano-hooks.svg?style=for-the-badge
[license-href]: https://github.com/keksiqc/nano-hooks/blob/main/LICENSE
