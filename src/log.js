import { styleText } from "node:util";

/** Status symbols shared by the CLI and the staged runner. */
export const symbols = {
  done: styleText("green", "√"),
  fail: styleText("red", "×"),
  warn: styleText("yellow", "↓"),
  info: styleText("cyan", "-"),
  pending: styleText("gray", "*"),
};

/** Highlight `*name*` spans in a message. */
export function highlight(message) {
  return message.replace(/\*([^*]+)\*/g, (_, name) => styleText("yellow", name));
}

const print = (symbol, message) => process.stderr.write(`${symbol} ${message}\n`);

/** Status lines, written to stderr so stdout stays clean. */
export const log = {
  success: (message) => print(symbols.done, highlight(message)),
  warn: (message) => print(symbols.warn, highlight(message)),
  info: (message) => print(symbols.info, highlight(message)),
  error: (message) => print(symbols.fail, styleText("red", highlight(message))),
};
