import { COMMANDS, GLOBAL_OPTIONS } from "./args.js";

function formatRows(rows) {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, description]) => `  ${label.padEnd(width)}  ${description}`).join("\n");
}

function formatOptions(options) {
  const rows = Object.entries(options).map(([flag, { short, valueName, description }]) => [
    `${short ? `-${short}, ` : ""}--${flag}${valueName ? ` <${valueName}>` : ""}`,
    description,
  ]);
  return formatRows(rows);
}

export function formatHelp(defaultCommand) {
  const commandRows = COMMANDS.map(({ name, description, positionals = [] }) => {
    const usage = [name, ...positionals.map((argument) => `<${argument.name}>`)].join(" ");
    return [name === defaultCommand ? `${usage} (default)` : usage, description];
  });

  const sections = [
    "Usage: nano-hooks [command] [options]",
    `Commands:\n${formatRows(commandRows)}`,
    `Options:\n${formatOptions(GLOBAL_OPTIONS)}`,
  ];
  for (const { name, options, optionsHelp } of COMMANDS) {
    if (!options) continue;
    sections.push(`Options for ${name}:\n${formatOptions(options)}`);
    if (optionsHelp) sections.push(optionsHelp.map((line) => `  ${line}`).join("\n"));
  }
  return `${sections.join("\n\n")}\n`;
}
