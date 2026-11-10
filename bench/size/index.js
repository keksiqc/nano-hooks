// Adapted from nano-staged (MIT), see LICENSE.
// Install each runner alone and add up its node_modules, sub-dependencies included.
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { styleText } from "node:util";
import { RUNNERS, directorySize, install, installSpec, makeTempDir } from "../utils.js";

const tarballDir = await makeTempDir("nano-hooks-bench-pack");
const sizes = [];
try {
  for (const runner of RUNNERS) {
    const cwd = await makeTempDir("nano-hooks-bench-size");
    try {
      await writeFile(join(cwd, "package.json"), '{ "name": "bench", "private": true }');
      await install(cwd, [await installSpec(runner, tarballDir)]);
      sizes.push({ runner, size: await directorySize(join(cwd, "node_modules")) });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
} finally {
  await rm(tarballDir, { recursive: true, force: true });
}

process.stdout.write(styleText("gray", "Size of node_modules after npm install\n"));
const width = Math.max(...RUNNERS.map((runner) => runner.name.length)) + 1;
for (const { runner, size } of sizes) {
  const prefix = runner.local ? "+ " : "- ";
  const kb = Math.round(size / 1024).toString();
  process.stdout.write(
    `${prefix}${runner.name.padEnd(width)}${styleText("bold", kb.padStart(5))} kB\n`,
  );
}
