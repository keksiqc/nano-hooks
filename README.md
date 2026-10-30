# nano-hooks

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

A tiny Git hooks manager with zero dependencies and a built-in staged-file runner.

## Usage

```sh
pnpm add -D nano-hooks
```

Configure hooks in `package.json` (or `.nano-hooks.json`, `.nano-hooks.js`, `.nano-hooks.mjs`) and install them from a `prepare` script:

```json
{
  "scripts": { "prepare": "nano-hooks" },
  "nano-hooks": {
    "commit-msg": "node scripts/check-msg.js $1"
  },
  "nano-staged": {
    "*.{js,ts}": "eslint --fix",
    "*.css": ["prettier --write"]
  }
}
```

When a `nano-staged` config exists and no `pre-commit` hook is configured, `pre-commit` runs the staged runner automatically. To run it alongside other commands, define `pre-commit` yourself, for example `"pre-commit": "nano-hooks staged && pnpm test"`.

Hook scripts put `node_modules/.bin` on `PATH`, so locally installed tools just work. Set `SKIP_NANO_HOOKS=1` to skip every hook for one command, for example `SKIP_NANO_HOOKS=1 git commit`.

Hooks that already exist and were not written by nano-hooks are never overwritten or removed. `install` reports them and moves on. Hooks that nano-hooks wrote earlier but are no longer configured are removed, unless `preserveUnused` is `true` or lists their names.

### CLI

| Command                              | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `nano-hooks` or `nano-hooks install` | Write the configured hooks.                              |
| `nano-hooks uninstall`               | Remove the hooks nano-hooks manages.                     |
| `nano-hooks staged`                  | Run the commands from the staged config on staged files. |

`staged` accepts `-c, --config <path>`, `--allow-empty` and `--bail`.

## Staged files

The `staged` command is based on [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov (MIT). It reads nano-staged's own config format and file locations, so an existing nano-staged config works unchanged. nano-hooks only supports staged files, so nano-staged's `--diff` and `--unstaged` modes are not included.

Unstaged changes to partially staged files are set aside while the commands run, formatter changes are added back to the commit, and everything is rolled back if a command fails.

## Development

This project uses JavaScript modules, pnpm, oxlint, oxfmt and vitest. No build step is required; the package exports `src/index.js` directly.

```sh
pnpm install
pnpm lint
pnpm fmt
pnpm test
```

CI checks formatting with `pnpm fmt --check`.

## Note for Developers

To publish the package for the first time, authenticate with npm and run `pnpm publish --access public` locally.

For automated releases, add an npm token with permission to publish this package as the repository's `NPM_TOKEN` Actions secret. The release workflow passes it to pnpm through `NODE_AUTH_TOKEN`.

Update the version in `package.json`, commit the change, then push a matching `v*` tag, for example `v0.1.0`. GitHub Actions runs the checks, publishes with `pnpm publish --access public`, and creates a GitHub release with generated notes.

## License

[MIT](./LICENSE) License © [Keksi](https://github.com/keksiqc)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/nano-hooks?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/nano-hooks
[npm-downloads-src]: https://img.shields.io/npm/dm/nano-hooks?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/nano-hooks
[bundle-src]: https://img.shields.io/bundlephobia/minzip/nano-hooks?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=nano-hooks
[license-src]: https://img.shields.io/github/license/keksiqc/nano-hooks.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/keksiqc/nano-hooks/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/nano-hooks
