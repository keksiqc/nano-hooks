// Adapted from nano-staged (MIT), see LICENSE.
// Time one run of each runner on 10 staged files. Usage: node bench/running-time/index.js [rounds]
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { styleText } from "node:util";
import { RUNNERS, exec, install, installSpec, makeTempDir, median } from "../utils.js";

const ROUNDS = Number(process.argv[2] ?? 10);
const TASKS = { "*.js": "prettier --write", "*.css": "prettier --write" };

const git = (cwd, ...args) => exec("git", args, { cwd });

async function createProject(cwd, tarballDir) {
  await git(cwd, "init", "--quiet");
  await git(cwd, "config", "user.name", "bench");
  await git(cwd, "config", "user.email", "bench@example.com");
  await git(cwd, "config", "commit.gpgsign", "false");
  await writeFile(join(cwd, ".gitignore"), "node_modules/\npackage-lock.json\n");
  await writeFile(join(cwd, "README.md"), "# Bench\n");
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "bench",
        private: true,
        "lint-staged": TASKS,
        "nano-staged": TASKS,
        "nano-hooks": { "pre-commit": { staged: TASKS } },
      },
      null,
      2,
    ),
  );
  await git(cwd, "add", "README.md", ".gitignore", "package.json");
  await git(cwd, "commit", "--quiet", "-m", "initial commit");

  const specs = await Promise.all(RUNNERS.map((runner) => installSpec(runner, tarballDir)));
  await install(cwd, [...specs, "prettier"]);

  for (const name of ["a", "b", "c", "d", "e"]) {
    await writeFile(join(cwd, `${name}.js`), "var test = {};");
    await writeFile(join(cwd, `${name}.css`), "body {color: red;}");
  }
  await git(cwd, "add", "--all");
}

async function time(cwd, runner) {
  const start = performance.now();
  await exec(`./node_modules/.bin/${runner.name}`, runner.args, { cwd });
  return performance.now() - start;
}

const cwd = await makeTempDir("nano-hooks-bench");
const tarballDir = await makeTempDir("nano-hooks-bench-pack");
try {
  await mkdir(cwd, { recursive: true });
  await createProject(cwd, tarballDir);

  const times = Object.fromEntries(RUNNERS.map((runner) => [runner.name, []]));
  // Warm up once so the first runner does not pay for a cold disk cache, then interleave the
  // rounds so that slow moments on the machine hit every runner alike.
  for (const runner of RUNNERS) await time(cwd, runner);
  for (let round = 0; round < ROUNDS; round++) {
    for (const runner of RUNNERS) times[runner.name].push(await time(cwd, runner));
  }

  process.stdout.write(styleText("gray", `Median of ${ROUNDS} runs, 10 staged files\n`));
  const width = Math.max(...RUNNERS.map((runner) => runner.name.length)) + 1;
  for (const runner of RUNNERS) {
    const prefix = runner.local ? "+ " : "- ";
    const ms = Math.round(median(times[runner.name])).toString();
    process.stdout.write(
      `${prefix}${runner.name.padEnd(width)}${styleText("bold", ms.padStart(5))} ms\n`,
    );
  }
} finally {
  await rm(cwd, { recursive: true, force: true });
  await rm(tarballDir, { recursive: true, force: true });
}
