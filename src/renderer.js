import { cursorTo, clearLine, moveCursor } from "node:readline";
import { styleText } from "node:util";
import { symbols } from "./log.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const FRAME_INTERVAL = 130;

const spinners = new WeakMap();

/** The next spinner frame for a task; every task spins independently. */
function spin(task) {
  const frame = ((spinners.get(task) ?? 0) + 1) % SPINNER_FRAMES.length;
  spinners.set(task, frame);
  return SPINNER_FRAMES[frame];
}

/** How many terminal rows `text` takes up at the given width, ignoring colour codes. */
function countRows(text, width) {
  return (
    text
      // oxlint-disable-next-line no-control-regex
      .replace(/\u001b[^m]*?m/g, "")
      .split("\n")
      .reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / width)), 0)
  );
}

function stateSymbol(task) {
  switch (task.state) {
    case "done":
      return symbols.done;
    case "fail":
      return symbols.fail;
    case "warn":
      return symbols.warn;
    case "run":
      return styleText("yellow", spin(task));
    default:
      return symbols.pending;
  }
}

/** The titles of a task and its ancestors, outermost first. */
function titleChain(task) {
  const titles = [];
  for (let current = task; current; current = current.parent) {
    if (current.title) titles.unshift(current.title);
  }
  return titles;
}

/** An interactive view: the whole task tree, redrawn in place. Finished tasks are folded. */
function renderTree(tasks, level = 0) {
  return tasks
    .flatMap((task) => {
      const line = `${"  ".repeat(level)}${stateSymbol(task)} ${task.title}`;
      return task.tasks?.length && task.state !== "done"
        ? [line, renderTree(task.tasks, level + 1)]
        : [line];
    })
    .join("\n");
}

/** A log view for non-interactive output: one line per finished leaf task, printed once. */
function renderLog(tasks) {
  let output = "";

  for (const task of tasks) {
    if (task.state && task.state !== "end" && task.state !== "run" && !task.tasks) {
      output += `${stateSymbol(task)} ${titleChain(task).join(styleText("yellow", " ≫ "))}\n`;
      task.state = "end";
    }

    if (task.tasks?.length) output += renderLog(task.tasks);
  }

  return output;
}

/**
 * Draw the task list to `stream`: redrawn in place on a terminal, appended otherwise.
 * @param {NodeJS.WritableStream} stream
 * @param {{ isTTY?: boolean, quiet?: boolean }} [options]
 */
export function createRenderer(stream, { isTTY = true, quiet = false } = {}) {
  const tasks = [];
  let rows = 0;
  let timer;

  function clear() {
    for (let i = 0; i < rows; i++) {
      if (i > 0) moveCursor(stream, 0, -1);
      cursorTo(stream, 0);
      clearLine(stream, 0);
    }
    rows = 0;
  }

  function render() {
    if (quiet) return;

    if (isTTY) {
      const output = renderTree(tasks);
      clear();
      stream.write(output);
      // Some terminals (script, bare ptys) report 0 columns, which would make rows infinite.
      rows = countRows(output, stream.columns || 80);
    } else {
      stream.write(renderLog(tasks));
    }
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
      if (quiet) return;

      if (isTTY) {
        const output = renderTree(tasks);
        clear();
        stream.write(`${output}\n${SHOW_CURSOR}`);
      } else {
        stream.write(renderLog(tasks));
      }
    },
  };
}
