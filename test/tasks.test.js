import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chunkFiles, createCommandGroups, splitCommand } from "../src/tasks.js";
import { createTempDir } from "./helpers.js";

describe("splitCommand", () => {
  it("splits on whitespace", () => {
    expect(splitCommand("prettier --write  --cache")).toEqual(["prettier", "--write", "--cache"]);
  });

  it("keeps quoted text together, once", () => {
    expect(splitCommand(`echo "a b" 'c d'`)).toEqual(["echo", "a b", "c d"]);
    expect(splitCommand(`run --name="a b"`)).toEqual(["run", `--name="a b"`]);
  });
});

describe("chunkFiles", () => {
  it("keeps all files in one chunk when they fit", () => {
    expect(chunkFiles(["a", "b", "c"], 10, 100)).toEqual([["a", "b", "c"]]);
  });

  it("starts a new chunk when the next file does not fit", () => {
    // 10 used + (4 + 1) per file: two files make 20, a third would make 25.
    expect(chunkFiles(["aaaa", "bbbb", "cccc", "dddd", "eeee"], 10, 24)).toEqual([
      ["aaaa", "bbbb"],
      ["cccc", "dddd"],
      ["eeee"],
    ]);
  });

  it("puts a file that is too long on its own", () => {
    expect(chunkFiles(["a", "long-file-name", "b"], 5, 10)).toEqual([
      ["a"],
      ["long-file-name"],
      ["b"],
    ]);
  });

  it("returns no chunks without files", () => {
    expect(chunkFiles([], 5, 10)).toEqual([]);
  });
});

/** The file counts of the calls that `count.js` recorded. */
const calls = (dir) => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").map(Number);

describe("createCommandGroups", () => {
  const cleanups = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

  /** A command that appends the number of files it received to `calls.log`. */
  function setup() {
    const t = createTempDir();
    cleanups.push(t.cleanup);
    writeFileSync(
      join(t.dir, "count.js"),
      `require("node:fs").appendFileSync("calls.log", process.argv.length - 2 + "\\n");\n`,
    );
    return t.dir;
  }

  it("runs a command once per chunk of files", async () => {
    const dir = setup();
    const files = ["a.js", "b.js", "c.js", "d.js", "e.js"];
    const [group] = await createCommandGroups({
      config: { "*.js": "node count.js" },
      files,
      cwd: dir,
      rootPath: dir,
      // Enough for the command and two of the absolute file paths, not for three.
      maxArgLength: "node count.js".length + 2 * (dir.length + 6) + 8,
    });

    await group.tasks[0].run();

    expect(calls(dir)).toEqual([2, 2, 1]);
  });
});
