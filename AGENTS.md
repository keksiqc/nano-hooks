## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm fmt && pnpm test`.
  Commits follow Conventional Commits.
- We use pnpm with Node, oxlint and oxfmt (oxc) for linting and formatting, and vitest for tests. You can run them with `pnpm lint`, `pnpm fmt` and `pnpm test`.

## CLI structure

- `src/cli.js` only parses the arguments and runs one command, or prints the help or the
  version for the `--help` and `--version` options. Each command is one file in
  `src/commands/` that holds its code and exports a `command` object. The list is in
  `src/commands/index.js`. The help text and the option checks are built from that list, so a
  new command only needs its own file, one line in `src/commands/index.js` and its README
  docs. Code outside `src/commands/` MUST NOT name a command or a command option.
- Code that several commands share, such as `src/hooks.js`, stays outside
  `src/commands/`. `src/index.js` is the public API and re-exports from the command files.
