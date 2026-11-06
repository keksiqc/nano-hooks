# Migrate to nano-hooks 0.5

nano-hooks 0.5 changes how you write the configuration. The commands and the hook scripts keep their names. The old shape no longer works, and nano-hooks tells you which key to move when it finds one.

## What changed

The configuration is now plain JSON in fewer places. nano-hooks never runs code to read it. The hooks moved to the top level, and `staged` moved into the `pre-commit` hook.

| In 0.4                                              | In 0.5                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.nano-hooks.js` and `.nano-hooks.mjs`              | Not read. Convert them to JSON. Finding one is an error.                      |
| `.nano-hooks.json` before `package.json`            | `package.json` first, then `nano-hooks.config.json`, then `.nano-hooks.json`. |
| Two sources, first one wins                         | Two sources are an error.                                                     |
| `"hooks": { "pre-push": "..." }`                    | `"pre-push": "..."`                                                           |
| `"staged": { ... }` at the top level                | `"pre-commit": { "staged": { ... } }`                                         |
| A function as a `staged` task                       | Not supported. Use a command.                                                 |
| `"preserveUnused"` at the top level                 | `"options": { "preserveUnused": ... }`                                        |
| `options.concurrent`                                | `parallel` (same meaning)                                                     |
| `--no-concurrent`                                   | `--no-parallel`                                                               |
| The changes of `staged` always joined the commit    | `restage`, default `true`. Set it to `false` to keep them out.                |
| The default `pre-commit` called `nano-hooks staged` | The script calls `nano-hooks staged`, then your `run` commands.               |

The `staged`, `bail`, `allowEmpty`, `parallel` and `restage` keys are valid in the `pre-commit` hook and, except for `staged`, in `options`. A command line option wins over the hook, and the hook wins over `options`.

## Steps

1. Update the package: `pnpm add -D nano-hooks@0.5`.
2. Open your configuration. It is in `package.json`, `.nano-hooks.json`, `.nano-hooks.js`, or `.nano-hooks.mjs`.
3. Move each entry of `hooks` to the top level.
4. Move `staged` into the `pre-commit` object. If you already had a `pre-commit` command, write it as `run` in the same object.
5. Move a top-level `preserveUnused` into `options`. Rename `concurrent` to `parallel`.
6. If you used a `.js` or `.mjs` file, write the same content as JSON and delete the old file. Replace each function task with a command.
7. Run `pnpm exec nano-hooks install`. If a key is still in the old place, the command lists it.

## Example

Before, in 0.4:

```json
{
  "nano-hooks": {
    "hooks": {
      "pre-commit": "npm run typecheck",
      "commit-msg": "commitlint --edit \"$1\""
    },
    "staged": {
      "*.{js,ts}": ["oxlint --fix", "prettier --write"]
    },
    "preserveUnused": ["post-merge"],
    "options": { "concurrent": false }
  }
}
```

In 0.4, the `pre-commit` command replaced the default hook, so `staged` did not run unless the command called `nano-hooks staged`. In 0.5, both run from one hook:

```json
{
  "nano-hooks": {
    "options": { "parallel": false, "preserveUnused": ["post-merge"] },
    "pre-commit": {
      "staged": {
        "*.{js,ts}": ["oxlint --fix", "prettier --write"]
      },
      "run": "npm run typecheck"
    },
    "commit-msg": "commitlint --edit \"$1\""
  }
}
```

The order is fixed: the `staged` step runs first and the `run` commands run second. The formatters change files, so the typecheck then sees the final code.

## Things to check after you migrate

Run `pnpm exec nano-hooks install` once. A hook script from 0.4 calls only `nano-hooks staged`. Until you install again, the `run` commands of the new `pre-commit` object are not in the script and do not run. The `prepare` script does this on the next `pnpm install`.

If your 0.4 `pre-commit` command was `nano-hooks staged && pnpm test`, write `"pre-commit": { "staged": { ... }, "run": "pnpm test" }` instead. The `nano-hooks staged` command still works, but it reads only `pre-commit.staged`. A `pre-commit` value that is a plain command has no `staged` key.

If a script calls the Node API, rename the `concurrent` option of `runStaged` to `parallel`. `runStaged` no longer accepts function tasks, and `loadConfig` returns `hooks`, `options` and `preserveUnused` only.
