# nano-hooks

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

A tiny Git hooks manager with zero dependencies.

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
