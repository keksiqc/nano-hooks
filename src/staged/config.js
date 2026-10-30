// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
import { resolve, parse } from "path";
import { pathToFileURL } from "url";
import fs from "fs";

const places = [
  `.nano-staged.js`,
  `nano-staged.js`,
  `.nano-staged.cjs`,
  `nano-staged.cjs`,
  `.nano-staged.mjs`,
  `nano-staged.mjs`,
  `.nano-staged.json`,
  `nano-staged.json`,
  `.nanostagedrc`,
  "package.json",
];

async function loadFile(path) {
  if (fs.existsSync(path) && fs.lstatSync(path).isFile()) {
    const { ext, name } = parse(path);

    if (ext === ".json" || name === ".nanostagedrc") {
      const config = JSON.parse(fs.readFileSync(path, "utf-8"));
      return name === "package" ? config["nano-staged"] : config;
    }

    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const { default: config } = await import(pathToFileURL(path));
      return typeof config === "function" ? { "*": config } : config;
    }
  }
}

// A broken nano-staged config file is an error (upstream silently ignored it).
// A broken package.json is not ours to report, so it still counts as "no config".
async function readConfig(path) {
  try {
    return await loadFile(path);
  } catch (error) {
    if (parse(path).base === "package.json") return undefined;
    throw new Error(`Failed to read ${path}: ${error.message}`, { cause: error });
  }
}

export async function getConfig(cwd = process.cwd(), config = undefined) {
  if (config) {
    return typeof config === "string" ? await readConfig(resolve(config)) : config;
  }

  let up = resolve(cwd);

  do {
    cwd = up;
    for (const place of places) {
      config = await readConfig(resolve(cwd, place));
      if (config) return config;
    }
    up = resolve(cwd, "..");
  } while (up !== cwd);
}

export function validConfig(config) {
  return !!(
    config &&
    Object.keys(config).length &&
    Object.keys(config).every(
      (key) =>
        key &&
        typeof key === "string" &&
        config[key] &&
        (typeof config[key] === "string" ||
          typeof config[key] === "function" ||
          (Array.isArray(config[key]) &&
            config[key].every((cmd) => cmd && typeof cmd === "string"))),
    )
  );
}
