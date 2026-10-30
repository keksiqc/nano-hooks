## Rules that apply everywhere

- **MUST**, **MUST NOT**, **SHOULD** and **MAY** use RFC 2119 meanings. They mark
  real invariants - layer boundaries, wire contracts, output shapes - not house style.
- Before a PR, all gates MUST pass:
  `pnpm lint && pnpm fmt && pnpm test`.
  Commits follow Conventional Commits.
- We use pnpm with Node, oxlint and oxfmt (oxc) for linting and formatting, and vitest for tests. You can run them with `pnpm lint`, `pnpm fmt` and `pnpm test`.
