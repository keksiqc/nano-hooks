/** @type {import("./index.js").Command} */
export const help = {
  name: "help",
  description: "Show this help",
  run({ usage }) {
    process.stdout.write(usage);
    return 0;
  },
};
