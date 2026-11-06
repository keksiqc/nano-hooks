import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRenderer } from "../src/renderer.js";
import {
  CommandError,
  chunkFiles,
  createCommandGroups,
  runCommandGroups,
  splitCommand,
} from "../src/tasks.js";
import { testTempDir } from "./helpers.js";

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

/** A command that appends the number of files it received to `calls.log`. */
function setup() {
  const t = testTempDir();
  writeFileSync(
    join(t.dir, "count.js"),
    `require("node:fs").appendFileSync("calls.log", process.argv.length - 2 + "\\n");\n`,
  );
  return t.dir;
}

describe("createCommandGroups", () => {
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

/** Two groups whose single task takes a moment; `log` records when each starts and ends. */
function groups(log) {
  return ["a", "b"].map((name) => {
    const group = { title: name, fileCount: 1 };
    group.tasks = [
      {
        title: name,
        pattern: name,
        run: async () => {
          log.push(`start ${name}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          log.push(`end ${name}`);
        },
      },
    ];
    return group;
  });
}

describe("runCommandGroups", () => {
  it("runs the groups side by side by default", async () => {
    const log = [];

    await runCommandGroups(groups(log));

    expect(log).toEqual(["start a", "start b", "end a", "end b"]);
  });

  it("runs the groups one after the other with parallel: false", async () => {
    const log = [];

    await runCommandGroups(groups(log), { parallel: false });

    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("skips the later groups after a failure with bail and parallel: false", async () => {
    const log = [];
    const [first, second] = groups(log);
    first.tasks[0].run = async () => {
      throw new Error("boom");
    };

    await expect(
      runCommandGroups([first, second], { parallel: false, bail: true }),
    ).rejects.toThrow(/boom/);
    expect(log).toEqual([]);
    expect(second.state).toBe("warn");
  });
});

/** A command task that takes a moment and then works or fails. */
function command(pattern, title, { fail = false } = {}) {
  return {
    title,
    pattern,
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (fail) throw new Error(`${title} broke\n`);
    },
  };
}

const group = (title, fileCount, tasks) => ({
  title,
  detail: `${fileCount} files`,
  fileCount,
  tasks,
});

/** Three groups: a failing command list, a working list and a group without files. */
function scenario() {
  return [
    group("*.js", 2, [
      command("*.js", "format"),
      command("*.js", "lint", { fail: true }),
      command("*.js", "test"),
    ]),
    group("*.css", 1, [command("*.css", "stylelint"), command("*.css", "prettier")]),
    group("*.md", 0, []),
  ];
}

/** The titles and states of a task tree, as plain data. */
const outcomes = (tasks) =>
  tasks.map((task) => {
    const node = { title: task.title, state: task.state };
    if (task.tasks) node.tasks = outcomes(task.tasks);
    return node;
  });

/** Run the scenario with the given output and return what happened to the tasks. */
async function execution(output, options) {
  const tree = scenario();
  const stream = { isTTY: output === "terminal", columns: 80, write: () => true };
  const renderer = createRenderer(stream, {
    isTTY: output === "terminal",
    quiet: output === "quiet",
  });
  renderer.start({ title: "Running tasks", state: "run", tasks: tree });

  let failures;
  try {
    await runCommandGroups(tree, options);
  } catch (error) {
    failures = error instanceof CommandError ? error.failures : error;
  } finally {
    renderer.stop();
  }
  return { tasks: outcomes(tree), failures };
}

describe("task outcomes", () => {
  it.each([
    ["parallel groups", { parallel: true }],
    ["sequential groups", { parallel: false }],
    ["parallel groups with bail", { parallel: true, bail: true }],
    ["sequential groups with bail", { parallel: false, bail: true }],
  ])("do not depend on how the progress is drawn: %s", async (_, options) => {
    const quiet = await execution("quiet", options);
    const terminal = await execution("terminal", options);
    const log = await execution("log", options);

    expect(terminal).toEqual(quiet);
    expect(log).toEqual(quiet);
    expect(quiet.failures).toEqual([{ pattern: "*.js", title: "lint", message: "lint broke" }]);
  });

  it("skips the rest of a failed command list and marks a group without files", async () => {
    const { tasks } = await execution("log", { parallel: false });

    expect(tasks.map(({ title, state }) => [title, state])).toEqual([
      ["*.js", "fail"],
      ["*.css", "done"],
      ["*.md", "warn"],
    ]);
    expect(tasks[0].tasks.map((task) => task.state)).toEqual(["done", "fail", "warn"]);
  });

  it("cancels the later groups after a failure with bail", async () => {
    const { tasks } = await execution("log", { parallel: false, bail: true });

    expect(tasks[1].state).toBe("warn");
    expect(tasks[1].tasks.map((task) => task.state)).toEqual([undefined, undefined]);
  });

  it("keeps titles and the error message free of terminal styling", async () => {
    const tree = scenario();
    const error = await runCommandGroups(tree).catch((caught) => caught);

    expect(tree.flatMap((node) => [node].concat(node.tasks)).map((task) => task.title)).toEqual([
      "*.js",
      "format",
      "lint",
      "test",
      "*.css",
      "stylelint",
      "prettier",
      "*.md",
    ]);
    // oxlint-disable-next-line no-control-regex
    expect(error.message).not.toMatch(/\u001b/);
    expect(error.message).toBe("*.js > lint:\nlint broke");
  });
});
