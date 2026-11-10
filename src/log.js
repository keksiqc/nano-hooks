import { clearScreenDown, cursorTo, moveCursor } from "node:readline";
import { stripVTControlCharacters, styleText } from "node:util";

const symbols = {
  done: styleText("green", "√"),
  fail: styleText("red", "×"),
  warn: styleText("yellow", "↓"),
  info: styleText("cyan", "-"),
  pending: styleText("gray", "*"),
};

const SPINNER = ["-", "\\", "|", "/"];
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const FRAME_INTERVAL = 130;

/** One status line, written to stderr so stdout stays clean. */
const line =
  (icon, color) =>
  (message, stream = process.stderr) =>
    stream.write(`${icon} ${color ? styleText(color, message) : message}\n`);

export const log = {
  success: line(symbols.done),
  warn: line(symbols.warn),
  info: line(symbols.info),
  error: line(symbols.fail, "red"),
};

/** How many terminal rows `text` takes up at the given width, ignoring colour codes. */
const countRows = (text, width) =>
  stripVTControlCharacters(text)
    .split("\n")
    .reduce((rows, row) => rows + Math.max(1, Math.ceil(row.length / width)), 0);

/** A task title as shown: a detail is dimmed, and the title of a failed task is red. */
function title(task) {
  const text = task.state === "fail" ? styleText("red", task.title) : task.title;
  return task.detail ? `${text}${styleText("dim", ` - ${task.detail}`)}` : text;
}

/** The symbol of a task: its state, or the spinner frame while it runs. */
function symbol(task, frame) {
  if (task.state === "run") return styleText("yellow", SPINNER[frame % SPINNER.length]);
  return symbols[task.state] ?? symbols.pending;
}

/** The whole task tree for a terminal. A finished group is folded into one line. */
function tree(tasks, frame, level = 0) {
  return tasks
    .flatMap((task) => {
      const row = `${"  ".repeat(level)}${symbol(task, frame)} ${title(task)}`;
      return task.tasks?.length && task.state !== "done"
        ? [row, tree(task.tasks, frame, level + 1)]
        : [row];
    })
    .join("\n");
}

/**
/**
 * Draw a task list to `stream`: redrawn in place on a terminal, appended otherwise. A task is
 * `{ title, state, detail?, tasks? }`. The code that runs it sets `state` (`run`, `done`,
 * `fail` or `warn`, none while it waits). The renderer never writes it.
 */
export function createRenderer(stream, { isTTY = true, quiet = false } = {}) {
  const tasks = [];
  const printed = new Set();
  let frame = 0;
  let rows = 0;
  let timer;

  /** Without a terminal: one line for each finished leaf task, printed once. */
  function leaves(list, parents = []) {
    let output = "";
    for (const task of list) {
      const chain = [...parents, title(task)];
      if (task.tasks) {
        output += leaves(task.tasks, chain);
      } else if (task.state && task.state !== "run" && !printed.has(task)) {
        printed.add(task);
        output += `${symbol(task)} ${chain.join(styleText("yellow", " ≫ "))}\n`;
      }
    }
    return output;
  }

  function render(last = false) {
    if (quiet) return;
    if (!isTTY) {
      stream.write(leaves(tasks));
      return;
    }

    const output = tree(tasks, frame++);
    if (rows) {
      moveCursor(stream, 0, 1 - rows);
      cursorTo(stream, 0);
      clearScreenDown(stream);
    }
    stream.write(last ? `${output}\n${SHOW_CURSOR}` : output);
    // Some terminals (script, bare ptys) report 0 columns, which would make rows infinite.
    rows = countRows(output, stream.columns || 80);
  }

  function loop() {
    timer = setTimeout(loop, FRAME_INTERVAL);
    render();
  }

  return {
    start(task) {
      tasks.push(task);
      if (timer) return;

      if (isTTY && !quiet) stream.write(HIDE_CURSOR);
      loop();
    },

    stop() {
      clearTimeout(timer);
      timer = undefined;
      render(true);
    },
  };
}
