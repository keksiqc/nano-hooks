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
const format = (message, { markup = true } = {}) => (markup ? highlight(message) : message);

/**
 * Status lines, written to stderr so stdout stays clean. Pass `{ markup: false }`
 * for text that may contain literal asterisks, such as glob patterns.
 */
export const log = {
  success: (message, options) => print(symbols.done, format(message, options)),
  warn: (message, options) => print(symbols.warn, format(message, options)),
  info: (message, options) => print(symbols.info, format(message, options)),
  error: (message, options) => print(symbols.fail, styleText("red", format(message, options))),
};
