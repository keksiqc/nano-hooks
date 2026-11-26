## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm fmt && pnpm test`.
  Commits follow Conventional Commits.
- We use pnpm with Node, oxlint and oxfmt (oxc) for linting and formatting, and vitest for tests. You can run them with `pnpm lint`, `pnpm fmt` and `pnpm test`.

## CLI structure

- Each file in `src/commands/` defines its command name, arguments, flags, help descriptions,
  and CLI handler. Register new command definitions in `src/args.js` and update the README.
  `src/args.js` parses the arguments, `src/help.js` generates help from the definitions, and
  `src/cli.js` runs the selected handler or handles `--help` and `--version`. The help text
  MUST list every registered command and option. A test checks this.
- Commands expose plain functions for the library. Command handlers and runners MUST use the
  `log` helper for terminal output. Code that several commands share, such as
  `src/hooks.js`, `src/git.js` and `src/config.js`, stays outside `src/commands/`. `src/index.js`
  re-exports the public functions.
- The library entry `src/index.js` MUST NOT import `src/cli.js`, `src/args.js` or
  `src/help.js`. Code that only the CLI uses stays out of the library bundle that way.
