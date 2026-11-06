/** Lines of `label  description`, with the descriptions lined up. */
function table(rows) {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return rows.map(([label, description]) => {
    const [first, ...rest] = description.split("\n");
    return [
      `  ${label.padEnd(width)}${first}`,
      ...rest.map((line) => `  ${" ".repeat(width)}${line}`),
    ].join("\n");
  });
}

const indent = (text) => text.split("\n").map((line) => `  ${line}`);

/**
 * Build the help text from the command table and the global options.
 * @param {import("./commands/index.js").Command[]} commands
 * @param {import("./args.js").GLOBAL_OPTIONS} globalOptions
 */
export function buildUsage(commands, globalOptions) {
  const sections = [
    ["Usage: nano-hooks [command] [options]"],
    [
      "Commands:",
      ...table(
        commands.map((c) => [
          `${c.usage ?? c.name}${c.default ? " (default)" : ""}`,
          c.description,
        ]),
      ),
    ],
    [
      "Options:",
      ...table(
        globalOptions.map((o) => [
          [o.flags.join(", "), o.arg].filter(Boolean).join(" "),
          o.description,
        ]),
      ),
    ],
  ];

  for (const c of commands) {
    if (!c.flags && !c.note) continue;
    sections.push([
      `Options for ${c.name}:`,
      ...(c.flags ? table(c.flags.map((f) => [f.flags.join(", "), f.description])) : []),
      ...(c.flags && c.note ? [""] : []),
      ...(c.note ? indent(c.note) : []),
    ]);
  }

  return `${sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}
