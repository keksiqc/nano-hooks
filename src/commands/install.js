import { installHooks } from "../hooks.js";

export { install } from "../hooks.js";

/** @type {import("./index.js").Command} */
export const command = {
  name: "install",
  default: true,
  description: "Write the configured git hooks",
  run: ({ options }) => installHooks(options.config),
};
