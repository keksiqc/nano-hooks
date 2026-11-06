import { cursorTo, clearLine, moveCursor } from "node:readline";
import { styleText } from "node:util";
import { symbols } from "./log.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const FRAME_INTERVAL = 130;

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

/** A task title as shown: a detail is dimmed, and the title of a failed task is red. */
function displayTitle(task) {
  const title = task.state === "fail" ? styleText("red", task.title) : task.title;
  return task.detail ? `${title}${styleText("dim", ` - ${task.detail}`)}` : title;
}

/**
 * The views of a task tree. They only read the tasks, which belong to whoever runs them:
 * what a view must remember, such as the spinner frames or the lines it printed, goes in
 * `memory`, one per renderer.
 * @param {{ spinners: WeakMap<object, number>, printed: WeakSet<object> }} memory
 */
function createViews({ spinners, printed }) {
  /** The next spinner frame for a task; every task spins independently. */
  function spin(task) {
    const frame = ((spinners.get(task) ?? 0) + 1) % SPINNER_FRAMES.length;
    spinners.set(task, frame);
    return SPINNER_FRAMES[frame];
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

  /** An interactive view: the whole task tree, redrawn in place. Finished tasks are folded. */
  function tree(tasks, level = 0) {
    return tasks
      .flatMap((task) => {
        const line = `${"  ".repeat(level)}${stateSymbol(task)} ${displayTitle(task)}`;
        return task.tasks?.length && task.state !== "done"
          ? [line, tree(task.tasks, level + 1)]
          : [line];
      })
      .join("\n");
  }

  /**
   * A log view for non-interactive output: one line per finished leaf task, printed once.
   * `titles` are the titles of the tasks above, outermost first.
   */
  function log(tasks, titles = []) {
    let output = "";

    for (const task of tasks) {
      const chain = [...titles, displayTitle(task)];

      if (task.state && task.state !== "run" && !task.tasks && !printed.has(task)) {
        output += `${stateSymbol(task)} ${chain.join(styleText("yellow", " ≫ "))}\n`;
        printed.add(task);
      }

      if (task.tasks?.length) output += log(task.tasks, chain);
    }

    return output;
  }

  return { tree, log };
}

/**
 * Draw the task list to `stream`: redrawn in place on a terminal, appended otherwise.
 *
 * The renderer only observes. A task is `{ title, state, detail?, tasks? }`: the code that
 * runs it sets `state` (`run`, `done`, `fail` or `warn`, none while it waits) and the
 * renderer never writes to it. The renderer keeps its own print history and spinner
 * frames, so tasks can be drawn by several renderers.
 * @param {NodeJS.WritableStream} stream
 * @param {{ isTTY?: boolean, quiet?: boolean }} [options]
 */
export function createRenderer(stream, { isTTY = true, quiet = false } = {}) {
  const tasks = [];
  const views = createViews({ spinners: new WeakMap(), printed: new WeakSet() });
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
      const output = views.tree(tasks);
      clear();
      stream.write(output);
      // Some terminals (script, bare ptys) report 0 columns, which would make rows infinite.
      rows = countRows(output, stream.columns || 80);
    } else {
      stream.write(views.log(tasks));
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
        const output = views.tree(tasks);
        clear();
        stream.write(`${output}\n${SHOW_CURSOR}`);
      } else {
        stream.write(views.log(tasks));
      }
    },
  };
}
