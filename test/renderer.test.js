import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/renderer.js";

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
});
