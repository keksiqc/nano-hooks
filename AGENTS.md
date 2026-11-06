## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm fmt && pnpm test`.
  Commits follow Conventional Commits.
- We use pnpm with Node, oxlint and oxfmt (oxc) for linting and formatting, and vitest for tests. You can run them with `pnpm lint`, `pnpm fmt` and `pnpm test`.

## CLI structure

- `src/cli.js` maps the command line to one handler, or prints the help or the version for
  the `--help` and `--version` options. A handler calls the code of its command and prints
  the result. `src/args.js` parses the arguments, and `src/help.js` holds the help text.
  A new command needs a name in `src/args.js`, a handler in `src/cli.js`, a line in
  `src/help.js` and its README docs. The help text MUST list every command and option in
  `src/args.js`. A test checks this.
- The code of a command is one file in `src/commands/`. It exports plain functions and MUST
  NOT print to the terminal, except through the `log` helper of a runner. Code that several
  commands share, such as `src/hooks.js` and `src/config.js`, stays outside
  `src/commands/`. `src/index.js` is the public API and re-exports from these files.
- The library entry `src/index.js` MUST NOT import `src/cli.js`, `src/args.js` or
  `src/help.js`. Code that only the CLI uses stays out of the library bundle that way.
