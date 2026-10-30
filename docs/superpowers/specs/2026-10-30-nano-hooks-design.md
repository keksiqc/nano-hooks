# nano-hooks design

A tiny, dependency-free Git hooks manager modelled on
[simple-git-hooks](https://github.com/toplenboren/simple-git-hooks), with a
staged-file runner vendored from
[nano-staged](https://github.com/usmanyunusov/nano-staged) so users install a
single package.

## Goals

- Install, update and remove Git hooks from a small config.
- Run lint/format commands on staged files before a commit (`nano-staged`
  behavior) from the same package.
- Zero runtime dependencies. Only `node:` built-ins, working on Node and Bun.
- Existing nano-staged configs work unchanged.

## Non-goals

- `--diff` and `--unstaged` modes of nano-staged (the file source is always
  the staged set).
- A watch mode, hook templates, or a hook-management UI.

## Public surface

CLI `nano-hooks`:

| Command                   | Behavior                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `nano-hooks`, `install`   | Write the configured hooks into the hooks dir.                                      |
| `nano-hooks uninstall`    | Remove the hook scripts nano-hooks manages.                                         |
| `nano-hooks staged [...]` | Run the staged-file runner. Flags: `--config/-c <path>`, `--allow-empty`, `--bail`. |

API from `src/index.js`: `install()`, `uninstall()`, `runStaged()`,
`loadConfig()`. `package.json` gets a `bin` entry and `engines.node` matching
the vendored runner (`^22 || >=24`, relaxed only if the vendored code is
verified to work on older Node).

## Configuration

Two configs, each in its natural format.

**Hooks config** - the `nano-hooks` key in `package.json`, or
`.nano-hooks.json` / `.nano-hooks.js` / `.nano-hooks.mjs`. Hook names map to
a command string. `preserveUnused` (boolean or array of hook names) is the
only reserved key.

```json
"nano-hooks": { "commit-msg": "node scripts/check-msg.js $1" }
```

**Staged config** - nano-staged's own format, read from nano-staged's own
locations. First match wins, in this order: `.nano-staged.js`,
`nano-staged.js`, `.nano-staged.cjs`, `nano-staged.cjs`, `.nano-staged.mjs`,
`nano-staged.mjs`, `.nano-staged.json`, `nano-staged.json`, `.nanostagedrc`,
the `nano-staged` key in `package.json`. `--config` overrides discovery.

```json
"nano-staged": { "*.{js,ts}": "eslint --fix", "*.css": ["prettier --write"] }
```

Values are a string or an array of strings. JS/MJS configs may export a
function, or an object whose values are functions. A function receives
`{ filenames, type }` (`type` is always `"staged"`) and returns a command or an
array of commands.

**Auto-wiring:** if a staged config exists and the hooks config defines no
`pre-commit`, the `pre-commit` hook runs `nano-hooks staged`. Defining a
`pre-commit` overrides this.

## Hook installation

- The hooks dir comes from `git rev-parse --git-path hooks`, which handles
  worktrees and `core.hooksPath`.
- Each script is `#!/bin/sh` plus a marker comment, mode 0755. The script
  invokes the CLI by its resolved path, not via `npx`, so it is fast and works
  offline. Scripts are regenerated on every `install`, which suits a `prepare`
  script.
- `uninstall` and cleanup of hooks removed from the config touch only scripts
  that carry the marker. Hand-written hooks are never modified or deleted.
  `preserveUnused` keeps managed hooks that are no longer configured.
- `SKIP_NANO_HOOKS=1` makes any installed hook exit 0 without running.
- Running outside a Git repository is an error with a clear message.

## Staged runner (vendored from nano-staged)

Source: nano-staged 1.0.2 (MIT, no runtime dependencies), copied into
`src/staged/` and adapted to this repo's style. Pieces: config discovery,
glob-to-regex, git helpers, git workflow (backup of unstaged changes, restore,
rollback on failure), command runner. The renderer and reporter are trimmed if
heavier than needed. Behavior is unchanged from upstream apart from the
CLI entry point and the dropped `--diff`/`--unstaged` modes.

Attribution (MIT requirement): the nano-staged copyright and license text is
kept in `src/staged/LICENSE`, each vendored file keeps a header naming its
origin, and the README carries a notice (below).

## README notice

The README gets a short section stating that the `staged` subcommand is
based on nano-staged, with a link to
`https://github.com/usmanyunusov/nano-staged`.

## Error handling

- Missing staged config: `nano-hooks staged` exits 1 with a clear message.
- A failing command: its output is printed, the git workflow rolls back to the
  pre-run state, exit 1.
- Empty result after commands run: blocked unless `--allow-empty`.
- Other cases (no matching files, rename-only commits, unstaged-patch
  re-apply conflicts) follow upstream behavior and each gets a test.

## Testing (vitest)

- Unit: config discovery precedence, hooks config loading, function-value
  configs, marker detection.
- Integration, against real temp git repos: install and uninstall,
  `preserveUnused`, `core.hooksPath`, worktrees, non-git directory;
  staged runner happy path, formatter-modified files re-added, partially
  staged file keeping its unstaged hunks, failing command rolling back,
  `--allow-empty`, `SKIP_NANO_HOOKS`.
- Dev toolchain: pnpm, Node, oxlint and oxfmt (oxc), and vitest. Quality gates
  are `pnpm lint`, `pnpm fmt` and `pnpm test`, per `AGENTS.md`. CI runs on
  Node 22 and 24.

## Open items

- Confirm the minimum Node version after the vendored code is in place.
