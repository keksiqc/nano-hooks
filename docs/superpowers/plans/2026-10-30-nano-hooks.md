# nano-hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free Git hooks manager (simple-git-hooks style) with a staged-file runner vendored from nano-staged, shipped as one package.

**Architecture:** `src/config.js` loads the hooks config, `src/hooks.js` writes/removes marker-tagged hook scripts, `src/staged/` is nano-staged 1.0.2 copied in and trimmed to staged-only, and `src/cli.js` wires the three commands. `src/index.js` re-exports the API. Everything is plain ESM JS on `node:` built-ins.

**Tech Stack:** JavaScript ESM on Node `^22 || >=24`; pnpm; oxlint and oxfmt (oxc) for lint/format; vitest for tests (all dev-only).

**Spec:** `docs/superpowers/specs/2026-10-30-nano-hooks-design.md`

## Global Constraints

- Zero runtime dependencies; only `node:` built-ins. `package.json` `dependencies` stays absent. Dev tooling lives in `devDependencies` only: `vitest`, `oxlint`, `oxfmt`.
- Tests import from `vitest` (`describe`, `it`, `expect`); they spawn `node` and `git`, never Bun-specific APIs.
- `engines.node` is `^22 || >=24` (the vendored code uses `util.styleText`).
- Vendored source: nano-staged 1.0.2 (MIT). Keep its copyright/license text in `src/staged/LICENSE`, and a one-line origin header in every vendored file: `// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged`.
- The staged runner supports staged files only. No `--diff`, no `--unstaged`. CLI flags for `staged`: `--config/-c <path>`, `--allow-empty`, `--bail`.
- Staged config is read in nano-staged's own format and locations (precedence: `.nano-staged.js`, `nano-staged.js`, `.nano-staged.cjs`, `nano-staged.cjs`, `.nano-staged.mjs`, `nano-staged.mjs`, `.nano-staged.json`, `nano-staged.json`, `.nanostagedrc`, `nano-staged` key in `package.json`).
- Hooks config: `nano-hooks` key in `package.json`, or `.nano-hooks.json` / `.nano-hooks.js` / `.nano-hooks.mjs`. Reserved key: `preserveUnused` (boolean or array of hook names).
- Hook scripts: `#!/bin/sh`, marker comment, mode 0755. Only marker-tagged scripts are ever modified or deleted.
- `SKIP_NANO_HOOKS=1` makes an installed hook exit 0 without running.
- Hooks dir comes from `git rev-parse --git-path hooks`.
- Commits follow Conventional Commits. Scripts (defined in Task 0): `lint` = `oxlint`, `fmt` = `oxfmt`, `test` = `vitest run`. The gate is `pnpm lint && pnpm fmt --check && pnpm test` (CI); locally `pnpm lint && pnpm fmt && pnpm test`.

## Review Focus

Failure modes the spec implies but does not state; each has a test in the owning task:

1. Project path containing spaces or a quote: generated hook scripts must still run (Task 3).
2. An unmanaged (hand-written) hook already exists at an install target: it is left untouched and reported, never overwritten (Task 3).
3. Staged runner started in a monorepo sub-package (cwd is not the git root): only files under cwd are processed (Task 1).
4. Deletion-only or rename-only commits: no crash, no command run on deleted paths (Task 1).
5. Staged filenames with spaces: passed to commands as single arguments (Task 1).

## File Structure

| Path                                                                                   | Responsibility                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/staged/*.js`, `src/staged/LICENSE`                                                | Vendored, trimmed nano-staged. Entry: `src/staged/index.js` (`runStaged`). |
| `src/config.js`                                                                        | Load and validate the hooks config.                                        |
| `src/hooks.js`                                                                         | `install` / `uninstall`: hook scripts, hooks dir resolution, cleanup.      |
| `src/cli.js`                                                                           | `nano-hooks` binary: argument parsing, exit codes.                         |
| `src/index.js`                                                                         | Public API re-exports. Replaces the placeholder exports.                   |
| `package.json`, `vitest.config.js`, `.github/workflows/*`, `.vscode/*`, `AGENTS.md`    | Toolchain: pnpm, oxc, vitest (Task 0).                                     |
| `test/helpers.js`                                                                      | `createRepo` temp-git-repo helper.                                         |
| `test/staged.test.js`, `test/config.test.js`, `test/hooks.test.js`, `test/cli.test.js` | Tests per task.                                                            |

---

### Task 0: Toolchain (pnpm, oxc, vitest)

**Files:**

- Modify: `package.json`, `AGENTS.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.vscode/settings.json`, `.vscode/extensions.json`, `README.md` (Development and release sections only)
- Create: `vitest.config.js`, `pnpm-lock.yaml` (generated)

**Interfaces:**

- Produces: scripts `lint` (`oxlint`), `fmt` (`oxfmt`), `test` (`vitest run`); `pnpm fmt --check` passes the flag through to oxfmt. Later tasks rely on these names.

- [ ] **Step 1: Update `package.json`.** Set `"packageManager": "pnpm@12.15.0"`, `"scripts": { "lint": "oxlint", "fmt": "oxfmt", "test": "vitest run" }`, and `devDependencies` for `vitest`, `oxlint`, `oxfmt` via `pnpm add -D vitest oxlint oxfmt` (this also writes `pnpm-lock.yaml`). Add `"engines": { "node": "^22 || >=24" }`. If pnpm reports ignored build scripts, leave them ignored.

- [ ] **Step 2: Create `vitest.config.js`** exporting `defineConfig({ test: { include: ["test/**/*.test.js"], testTimeout: 30_000 } })` (the tests spawn real `git`).

- [ ] **Step 3: Update CI.** `ci.yml`: matrix `node: [22, 24]`; steps `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4` (with `node-version: ${{ matrix.node }}` and `cache: pnpm`), `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm fmt --check`, `pnpm test`. `release.yml`: same setup on Node 24 with `registry-url: https://registry.npmjs.org`, the same three checks, then `pnpm publish --access public --provenance --no-git-checks` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` and `id-token: write` added to `permissions`; keep the existing `gh release create` step. Remove the `bun pm pack` step.

- [ ] **Step 4: Update editor config and docs.** `.vscode/extensions.json` recommends `oxc.oxc-vscode`; `.vscode/settings.json` sets it as default formatter (keep `formatOnSave`). `AGENTS.md`: gates become `pnpm lint && pnpm fmt && pnpm test`, and the tooling sentence names pnpm, oxlint/oxfmt and vitest instead of Bun. `README.md`: Development commands become `pnpm install`, `pnpm lint`, `pnpm fmt`, `pnpm test`; the release note publishes with `pnpm publish --access public` and the token secret is `NPM_TOKEN` (exposed as `NODE_AUTH_TOKEN`).

- [ ] **Step 5: Verify.** Run: `pnpm install && pnpm lint && pnpm fmt --check`. Expected: all exit 0 (`pnpm test` is verified from Task 1, when the first test file exists; vitest exits 1 with no test files).

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "chore: add project scaffold, design spec, plan and pnpm/oxc/vitest toolchain"
```

---

### Task 1: Vendored staged runner

**Files:**

- Create: `src/staged/{index,config,cmd-runner,errors,executor,git,git-workflow,glob-to-regex,renderer,reporter,runner,utils}.js`, `src/staged/LICENSE`, `test/helpers.js`, `test/staged.test.js`
- Source to copy from: `https://registry.npmjs.org/nano-staged/-/nano-staged-1.0.2.tgz` (`package/lib/*.js`, `package/LICENSE`). Extract into a fresh empty directory outside the repo.

**Interfaces:**

- Produces:
  - `runStaged(options?: { cwd?: string, config?: string | object, allowEmpty?: boolean, bail?: boolean, quiet?: boolean, stream?: NodeJS.WritableStream }): Promise<void>` in `src/staged/index.js` (default export of upstream `index.js`, renamed, without `unstaged`/`diff` options). Resolves when done or when there is nothing to do; rejects on any failure (upstream throws an error or an array of errors).
  - `getConfig(cwd?: string, config?: string | object): Promise<object | undefined>` re-exported from `src/staged/config.js` (used by Task 3).
  - `createRepo(files?: Record<string, string>): { dir: string, git(...args: string[]): string, write(path: string, content: string): void, read(path: string): string, cleanup(): void }` in `test/helpers.js`: `mkdtemp` dir, `git init`, set `user.name`/`user.email`, `commit.gpgsign=false`, write `files`, make an initial commit. Uses `node:child_process` `execFileSync`.

- [ ] **Step 1: Write the helpers and failing tests.** `test/staged.test.js` uses `createRepo`, and `runStaged({ cwd: repo.dir, quiet: true })`. Test fixtures write small Node scripts into the repo, e.g. `fmt.js` (`for each argv file: replace first line with its uppercase`), `fail.js` (`process.exit(1)`), `reset.js` (writes `x\n` to a file). Config is passed as `config: {"*.js": "node fmt.js"}`. Tests (assert on `repo.git("diff", "--cached")`, `repo.git("show", ":a.js")`, `repo.read(...)`):
  - `runs commands only on matching staged files`: stage `a.js` and `b.css`; config `*.js`; `a.js` is formatted and re-staged, `b.css` untouched.
  - `re-adds formatter-modified files to the index`: after the run `git diff --name-only` is empty.
  - `keeps unstaged hunks of partially staged files`: `a.js` committed as `one\ntwo\nthree\n`; stage first line changed to `uno`; then change line 3 to `tres` unstaged; after the run `git show :a.js` is `UNO\ntwo\nthree\n` and the working file is `UNO\ntwo\ntres\n`.
  - `rolls back everything when a command fails`: same partial setup, config `["node fmt.js", "node fail.js"]`; promise rejects; `git status --porcelain` and both file versions (`git show :a.js`, working file) are identical to the pre-run values.
  - `prevents an empty commit unless allowEmpty`: committed `x\n`; stage `y\n`; `reset.js` restores `x\n`; without `allowEmpty` rejects with a message containing `Prevented an empty git commit`; with `allowEmpty: true` resolves.
  - `does nothing when no staged file matches`: command would create a marker file; marker absent, resolves.
  - `rejects with a config message when no config exists`: message matches `/Create Nano Staged config/`.
  - `supports function values in a JS config`: `.nano-staged.mjs` exporting `{"*.js": ({ filenames }) => ["node fmt.js " + filenames.join(" ")]}`; file formatted.
  - `config discovery follows nano-staged precedence`: `getConfig` returns `.nano-staged.json` content when `package.json` also has a `nano-staged` key.
  - (Review Focus 3) `only processes files under cwd in a sub-package`: repo with `packages/a/.nano-staged.json` and staged `.js` files in `packages/a` and `packages/b`; `runStaged({ cwd: <packages/a> })` formats only the `a` file.
  - (Review Focus 4) `handles deletion-only and rename-only commits`: staging only a `git rm` / `git mv` neither rejects nor runs a command on the removed path.
  - (Review Focus 5) `passes filenames with spaces as single arguments`: stage `my file.js`; it is formatted.

- [ ] **Step 2: Run to verify failure.** Run: `pnpm vitest run test/staged.test.js`. Expected: FAIL (`Cannot find module '../src/staged/index.js'`).

- [ ] **Step 3: Vendor and trim the runner.** Copy the upstream `lib` files listed above (not `bin.js`, `index.d.ts`) and `LICENSE` into `src/staged/`. Adapt:
  - Add the origin header to every file.
  - Rename the default export in `index.js` to named export `runStaged`; drop the `unstaged` and `diff` options and the `opts.unstaged`/`opts.diff` branches (always `git.stagedFiles`, `type = 'staged'`).
  - Remove `git.unstagedFiles`, `git.changedFiles`, `git.diffFileName` and the `type === 'unstaged' || 'diff'` skip conditions in `runner.js`.
  - Remove `showVersion` and `getForceColorLevel` from `utils.js` (CLI-only helpers).
  - Remove no-op `try { ... } catch (e) { throw e }` wrappers. No other behavior changes.
  - Ensure `renderer` writes no cursor/ANSI control sequences when `quiet` is true, so tests can run with `quiet: true` on any stream.

- [ ] **Step 4: Run to verify pass.** Run: `pnpm vitest run test/staged.test.js`. Expected: all pass. If a test fails because of upstream behavior rather than a trimming mistake (for example Review Focus 3, 4 or 5), fix it in the vendored code and keep the test.

- [ ] **Step 5: Format and commit.** Run `pnpm fmt && pnpm lint && pnpm test`. Commit the runner:

```bash
git add src/staged test
git commit -m "feat(staged): vendor nano-staged runner (staged files only)"
```

---

### Task 2: Hooks config loader

**Files:**

- Create: `src/config.js`, `test/config.test.js`

**Interfaces:**

- Consumes: `createRepo` from `test/helpers.js` (Task 1).
- Produces:
  - `VALID_HOOKS: string[]` — githooks(5) hook names: `applypatch-msg pre-applypatch post-applypatch pre-commit pre-merge-commit prepare-commit-msg commit-msg post-commit pre-rebase post-checkout post-merge pre-push pre-receive update proc-receive post-receive post-update reference-transaction push-to-checkout pre-auto-gc post-rewrite sendemail-validate fsmonitor-watchman p4-changelist p4-prepare-changelist p4-post-changelist p4-pre-submit post-index-change`.
  - `loadConfig(cwd?: string): Promise<{ hooks: Record<string, string>, preserveUnused: boolean | string[] }>` — looks only in `cwd`; first match wins in this order: `.nano-hooks.js`, `.nano-hooks.mjs`, `.nano-hooks.json`, `package.json` (counts only if it has a `nano-hooks` key). No config yields `{ hooks: {}, preserveUnused: false }`. JS files are loaded with `import(pathToFileURL(path))` using the default export.

- [ ] **Step 1: Write failing tests** in `test/config.test.js` (use `createRepo`): `reads the nano-hooks key from package.json`; `prefers .nano-hooks.json over package.json`; `loads .nano-hooks.mjs default export`; `returns empty hooks when no config exists`; `separates preserveUnused from hooks` (`{ "pre-commit": "x", "preserveUnused": ["commit-msg"] }` → `hooks: {"pre-commit":"x"}`, `preserveUnused: ["commit-msg"]`); `rejects an unknown hook name` (message contains the name); `rejects a non-string command` (message contains the hook name).

- [ ] **Step 2: Run to verify failure.** Run: `pnpm vitest run test/config.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `loadConfig` and `VALID_HOOKS` in `src/config.js`.** Validation errors are plain `Error`s naming the offending key.

- [ ] **Step 4: Run to verify pass.** Run: `pnpm vitest run test/config.test.js`. Expected: PASS.

- [ ] **Step 5: Format and commit.**

```bash
pnpm fmt && pnpm lint && pnpm test
git add src/config.js test/config.test.js
git commit -m "feat: load hooks config from package.json or .nano-hooks files"
```

---

### Task 3: Install and uninstall

**Files:**

- Create: `src/hooks.js`, `test/hooks.test.js`

**Interfaces:**

- Consumes: `loadConfig(cwd)` (Task 2); `getConfig(cwd)` from `src/staged/config.js` (Task 1); `createRepo` (Task 1).
- Produces:
  - `install(options?: { cwd?: string }): Promise<{ installed: string[], removed: string[], skipped: string[] }>` — `skipped` lists hooks left alone because an unmanaged script exists there.
  - `uninstall(options?: { cwd?: string }): Promise<{ removed: string[] }>`
  - Both reject with an error containing `not a git repository` outside a repo.

Script format written for each hook (command is the configured string, `projectRoot` is `cwd` as an absolute path, single-quote-escaped):

```sh
#!/bin/sh
# nano-hooks: managed file, do not edit
if [ "${SKIP_NANO_HOOKS:-}" = "1" ]; then
  exit 0
fi
PATH='<projectRoot>/node_modules/.bin':"$PATH"
<command>
```

Auto-wired `pre-commit` (staged config found via `getConfig`, and no `pre-commit` configured) uses the command `<runtime> '<absolute path of src/cli.js>' staged` where `<runtime>` is `bun` when `process.versions.bun` is set, else `node`. The marker is the second line; "managed" means the file contains `# nano-hooks: managed file`.

- [ ] **Step 1: Write failing tests** in `test/hooks.test.js` (`createRepo`, plus `repo.git`):
  - `writes an executable managed script for each configured hook` (mode has the executable bits; contains marker and command).
  - `auto-wires pre-commit to the staged runner when a staged config exists` (script contains ` staged`); `does not auto-wire when pre-commit is configured`.
  - `the hook runs on commit`: config `"pre-commit": "touch ran"`; after `git commit` the file `ran` exists (end-to-end through real git).
  - `SKIP_NANO_HOOKS=1 skips the hook`: same setup, env set; `ran` absent, commit succeeds.
  - `exposes node_modules/.bin on PATH inside the hook`: put an executable `node_modules/.bin/hello` that touches `hello-ran`; config `"pre-commit": "hello"`; commit creates it.
  - (Review Focus 2) `leaves an unmanaged hook untouched and reports it in skipped`.
  - `removes managed hooks that are no longer configured`; `preserveUnused: true keeps them`; `preserveUnused: ["commit-msg"] keeps only that one`.
  - `install is idempotent` (second run produces identical file content).
  - `uninstall removes only managed hooks and keeps unmanaged ones`.
  - `honors core.hooksPath` (`git config core.hooksPath .githooks`; script in `.githooks`).
  - `installs into the shared hooks dir from a linked worktree` (`git worktree add`; install with `cwd` = worktree writes into the main repo's `.git/hooks`).
  - `rejects outside a git repository` (temp dir without `git init`).
  - (Review Focus 1) `works when the project path contains spaces and a quote`: create the repo inside a directory named `my "proj"` and repeat the `ran` commit test.

- [ ] **Step 2: Run to verify failure.** Run: `pnpm vitest run test/hooks.test.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `install` and `uninstall` in `src/hooks.js`.** Resolve the hooks dir with `git rev-parse --git-path hooks` run in `cwd` (resolve relative output against `cwd`); detect "not a repository" from git's failure. Write files with `mode: 0o755` and an explicit `chmod`. Unmanaged existing target: skip, record in `skipped`, never write.

- [ ] **Step 4: Run to verify pass.** Run: `pnpm vitest run test/hooks.test.js`. Expected: PASS.

- [ ] **Step 5: Format and commit.**

```bash
pnpm fmt && pnpm lint && pnpm test
git add src/hooks.js test/hooks.test.js
git commit -m "feat: install and uninstall managed git hook scripts"
```

---

### Task 4: CLI, public API, package metadata, README

**Files:**

- Create: `src/cli.js` (executable, `#!/usr/bin/env node`), `test/cli.test.js`
- Modify: `src/index.js` (replace placeholder exports), `package.json`, `README.md`

**Interfaces:**

- Consumes: `install`, `uninstall` (Task 3); `runStaged` (Task 1); `loadConfig` (Task 2).
- Produces:
  - `src/index.js` exports `install`, `uninstall`, `runStaged`, `loadConfig`.
  - CLI: `nano-hooks [install]`, `nano-hooks uninstall`, `nano-hooks staged [--config|-c <path>] [--allow-empty] [--bail]`, `-h/--help`. Exit 0 on success, 1 on failure or unknown command (usage printed to stderr). `install` prints installed/removed/skipped hooks.
  - `package.json`: add `"bin": { "nano-hooks": "./src/cli.js" }`; keep `exports`, `files` and `engines` (set in Task 0), and no `dependencies`.

- [ ] **Step 1: Write failing tests** in `test/cli.test.js`, spawning `node src/cli.js` (absolute path) with `cwd` set to a `createRepo` dir:
  - `staged formats staged files and exits 0` (`.nano-staged.json` plus `fmt.js`).
  - `staged exits 1 when a command fails` and `exits 1 without a config`.
  - `staged --allow-empty` lets an emptied commit through; without the flag it exits 1.
  - `install writes hooks and uninstall removes them`.
  - `unknown command exits 1 and prints usage`; `--help` exits 0.
  - End-to-end: `install` in a repo with a `nano-staged` config in `package.json`, stage a `.js` file, run `git commit`; the committed blob is the formatted version.

- [ ] **Step 2: Run to verify failure.** Run: `pnpm vitest run test/cli.test.js`. Expected: FAIL (`src/cli.js` missing).

- [ ] **Step 3: Implement `src/cli.js`, `src/index.js`, and the `package.json` changes.** Hand-rolled argument parsing (no dependency). `staged` passes `{ config, allowEmpty, bail }` to `runStaged` and sets `process.exitCode = 1` on rejection (upstream already printed the errors via its reporter). `chmod +x src/cli.js`.

- [ ] **Step 4: Update `README.md`.** Replace the one-line description area with: install (`pnpm add -D nano-hooks`), a `package.json` example (`"prepare": "nano-hooks"`, `nano-hooks` hooks config, `nano-staged` config), CLI reference, `SKIP_NANO_HOOKS`, and this notice: "The `staged` subcommand is based on [nano-staged](https://github.com/usmanyunusov/nano-staged) by Usman Yunusov (MIT)." Keep the existing Development and License sections.

- [ ] **Step 5: Run the full gate.** Run: `pnpm lint && pnpm fmt --check && pnpm test`. Expected: both exit 0.

- [ ] **Step 6: Commit.**

```bash
pnpm fmt
git add src/cli.js src/index.js package.json README.md test/cli.test.js
git commit -m "feat: add nano-hooks CLI, public API and docs"
```
