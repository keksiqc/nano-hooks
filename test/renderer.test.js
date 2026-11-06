import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer } from "../src/renderer.js";

const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const FRAME = 130;

/** A stream that collects what is written to it. */
function memoryStream(options = {}) {
  const chunks = [];
  return {
    isTTY: false,
    columns: 80,
    ...options,
    write(chunk) {
      chunks.push(chunk);
      return true;
    },
    get text() {
      return chunks.join("");
    },
  };
}

/** An execution tree that holds a finished, a failed, a skipped and a running leaf. */
function tree() {
  return {
    title: "Running tasks",
    state: "run",
    tasks: [
      {
        title: "*.js",
        detail: "2 files",
        state: "fail",
        tasks: [
          { title: "format", pattern: "*.js", state: "done" },
          { title: "lint", pattern: "*.js", state: "fail" },
          { title: "test", pattern: "*.js", state: "warn" },
        ],
      },
      { title: "*.css", detail: "no files", state: "warn", tasks: [] },
      { title: "slow", pattern: "*.md", state: "run" },
      { title: "waiting", pattern: "*.md" },
    ],
  };
}

const occurrences = (text, part) => text.split(part).length - 1;

afterEach(() => vi.useRealTimers());

describe("createRenderer", () => {
  it("does not loop forever on a terminal that reports width 0", () => {
    let writes = 0;
    const stream = {
      isTTY: true,
      columns: 0,
      write() {
        // A runaway clear loop would otherwise hang the test run.
        if (++writes > 1000) throw new Error("runaway clear loop");
      },
    };
    const renderer = createRenderer(stream, { isTTY: true });

    renderer.start({ title: "task", state: "run" });
    renderer.stop();

    expect(writes).toBeLessThan(100);
  });

  it.each([
    ["a log", { isTTY: false }],
    ["a terminal", { isTTY: true }],
    ["quiet output", { quiet: true }],
  ])("does not change the tasks it draws for %s", (_, options) => {
    vi.useFakeTimers();
    const step = tree();
    const before = structuredClone(step);
    const renderer = createRenderer(memoryStream(), options);

    renderer.start(step);
    vi.advanceTimersByTime(FRAME * 5);
    renderer.stop();

    expect(step).toEqual(before);
  });

  it("prints each finished leaf once, however often it redraws", () => {
    vi.useFakeTimers();
    const stream = memoryStream();
    const step = tree();
    const renderer = createRenderer(stream, { isTTY: false });

    renderer.start(step);
    vi.advanceTimersByTime(FRAME * 10);
    renderer.stop();
    renderer.stop();

    for (const title of ["format", "lint", "test"]) {
      expect(occurrences(stream.text, title)).toBe(1);
    }
    expect(stream.text).toContain("Running tasks");
    expect(stream.text).toContain("*.js");
  });

  it("prints a leaf that finishes later, once", () => {
    vi.useFakeTimers();
    const stream = memoryStream();
    const step = tree();
    const renderer = createRenderer(stream, { isTTY: false });

    renderer.start(step);
    vi.advanceTimersByTime(FRAME * 3);
    expect(stream.text).not.toContain("slow");
    step.tasks[2].state = "done";
    vi.advanceTimersByTime(FRAME * 3);
    renderer.stop();

    expect(occurrences(stream.text, "slow")).toBe(1);
  });

  it("keeps a separate print history for each renderer", () => {
    const step = tree();
    const first = memoryStream();
    const second = memoryStream();

    for (const stream of [first, second]) {
      const renderer = createRenderer(stream, { isTTY: false });
      renderer.start(step);
      renderer.stop();
    }

    expect(occurrences(first.text, "format")).toBe(1);
    expect(occurrences(second.text, "format")).toBe(1);
  });

  it("draws nothing in quiet mode", () => {
    vi.useFakeTimers();
    const stream = memoryStream({ isTTY: true });
    const renderer = createRenderer(stream, { isTTY: true, quiet: true });

    renderer.start(tree());
    vi.advanceTimersByTime(FRAME * 3);
    renderer.stop();

    expect(stream.text).toBe("");
  });

  it("clears its timer and shows the cursor again when it stops", () => {
    vi.useFakeTimers();
    const stream = memoryStream({ isTTY: true });
    const renderer = createRenderer(stream, { isTTY: true });

    renderer.start(tree());
    vi.advanceTimersByTime(FRAME * 3);
    expect(vi.getTimerCount()).toBe(1);
    renderer.stop();

    expect(vi.getTimerCount()).toBe(0);
    expect(stream.text.startsWith(HIDE_CURSOR)).toBe(true);
    expect(stream.text.endsWith(`${SHOW_CURSOR}`)).toBe(true);
  });

  it("folds a finished group in a terminal and shows an open one", () => {
    const stream = memoryStream({ isTTY: true });
    const step = tree();
    step.tasks[0].state = "done";
    const renderer = createRenderer(stream, { isTTY: true });

    renderer.start(step);
    renderer.stop();
    const last = stream.text.slice(stream.text.lastIndexOf("Running tasks"));

    expect(last).toContain("*.js");
    expect(last).not.toContain("format");
    expect(last).toContain("slow");
  });
});
