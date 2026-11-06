import { styleText } from "node:util";

/** Status symbols shared by the CLI and the task runner. */
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

/**
 * Status lines, written to stderr so stdout stays clean. Options:
 * - `markup: false` for text that may contain literal asterisks, such as glob patterns
 * - `stream` to write somewhere else than stderr
 */
function write(symbol, message, { markup = true, stream = process.stderr, color } = {}) {
  const text = markup ? highlight(message) : message;
  stream.write(`${symbol} ${color ? styleText(color, text) : text}\n`);
}

export const log = {
  success: (message, options) => write(symbols.done, message, options),
  warn: (message, options) => write(symbols.warn, message, options),
  info: (message, options) => write(symbols.info, message, options),
  error: (message, options) => write(symbols.fail, message, { ...options, color: "red" }),
};
