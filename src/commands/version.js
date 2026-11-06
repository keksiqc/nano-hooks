import { readFileSync } from "node:fs";

/** @type {import("./index.js").Command} */
export const version = {
  name: "version",
  description: "Show the version",
  run() {
    const manifest = new URL("../../package.json", import.meta.url);
    process.stdout.write(`${JSON.parse(readFileSync(manifest, "utf8")).version}\n`);
    return 0;
  },
};
