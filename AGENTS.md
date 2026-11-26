## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm fmt && pnpm test`.
  Commits follow Conventional Commits.
- We use pnpm with Node, oxlint and oxfmt (oxc) for linting and formatting, and vitest for tests. You can run them with `pnpm lint`, `pnpm fmt` and `pnpm test`.

## CLI structure

- Each file in `src/commands/` registers its command, arguments, flags, help descriptions,
  and handler with CAC. Wire new commands into `src/cli.js` and update the README. CAC parses
  arguments, generates help, and dispatches actions. The global and command help together
  MUST list every registered command and option. A test checks this.
- Commands expose plain functions for the library. Command handlers and runners MUST use the
  `log` helper for terminal output. Code that several commands share, such as
  `src/hooks.js`, `src/git.js` and `src/config.js`, stays outside `src/commands/`. `src/index.js`
  re-exports the public functions.
- Keep the library entry `src/index.js` independent of `src/cli.js` and CAC.
