# nano-hooks

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][license-href]

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

| Section          | Description                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hooks`          | Git hook name mapped to the shell command it runs.                                                                                                    |
| `staged`         | Glob pattern mapped to a command, a list of commands, or (in a JS config) a function returning them. This is the same format as a nano-staged config. |
| `preserveUnused` | `true`, or a list of hook names, to keep hooks that nano-hooks wrote earlier but that are no longer in `hooks`.                                       |

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

`staged` accepts `-c, --config <path>` (a nano-staged format file to use instead of the `staged` section), `--allow-empty` and `--bail`.

## Staged files

The `staged` command is based on [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov (MIT). The `staged` section uses nano-staged's own task format, so moving from nano-staged means moving its config under `staged` in the nano-hooks config. nano-hooks does not read `.nano-staged.*` files or the `nano-staged` key. It only supports staged files, so nano-staged's `--diff` and `--unstaged` modes are not included.

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

## License

[MIT](./LICENSE) License © [Keksi](https://github.com/keksiqc)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/nano-hooks?style=for-the-badge
[npm-version-href]: https://npmx.dev/package/nano-hooks
[npm-downloads-src]: https://img.shields.io/npm/dm/nano-hooks?style=for-the-badge
[npm-downloads-href]: https://npmx.dev/package/nano-hooks
[bundle-src]: https://img.shields.io/bundlephobia/minzip/nano-hooks?style=for-the-badge&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=nano-hooks
[license-src]: https://img.shields.io/github/license/keksiqc/nano-hooks.svg?style=for-the-badge
[license-href]: https://github.com/keksiqc/nano-hooks/blob/main/LICENSE
