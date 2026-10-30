// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
import { resolve, parse } from "path";
import { pathToFileURL } from "url";
import fs from "fs";

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

// Discovery lives in src/config.js; this only resolves what runStaged was given.
export async function getConfig(config) {
  if (!config) return undefined;
  return typeof config === "string" ? await readConfig(resolve(config)) : config;
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
