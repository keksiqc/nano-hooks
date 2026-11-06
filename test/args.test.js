import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { commands } from "../src/commands/index.js";

const parse = (...argv) => parseArgs(argv, commands);
const run = () => 0;

describe("parseArgs", () => {
  it("runs install when no command is given", () => {
    expect(parse().command.name).toBe("install");
  });

  it("takes options before and after the command", () => {
    expect(parse("-c", "a.json", "staged", "--bail").options).toEqual({
      config: "a.json",
      bail: true,
    });
    expect(parse("staged", "--no-parallel", "-c", "a.json").options).toEqual({
      parallel: false,
      config: "a.json",
    });
  });

  it("hands everything after the hook name to run", () => {
    const { command, args, options } = parse("run", "-c", "a.json", "commit-msg", "FILE", "--bail");

    expect(command.name).toBe("run");
    expect(args).toEqual(["commit-msg", "FILE", "--bail"]);
    expect(options).toEqual({ config: "a.json" });
  });

  it("hands everything after init to init", () => {
    expect(parse("init", "pnpm", "run", "--fix").args).toEqual(["pnpm", "run", "--fix"]);
  });

  it("returns the help and version actions as soon as it sees their option", () => {
    expect(parse("staged", "-h").action).toBe("help");
    expect(parse("-v", "--nope").action).toBe("version");
  });

  it("returns help over an unknown command, as before", () => {
    expect(parse("frobnicate", "-h").action).toBe("help");
  });

  it("gives a shared spelling the meaning of the chosen command", () => {
    const table = [
      {
        name: "a",
        description: "",
        run,
        flags: [{ flags: ["--x"], name: "x", value: 1, description: "" }],
      },
      {
        name: "b",
        description: "",
        run,
        flags: [{ flags: ["--x"], name: "y", value: 2, description: "" }],
      },
    ];

    expect(parseArgs(["--x", "b"], table).options).toEqual({ y: 2 });
    expect(parseArgs(["a", "--x"], table).options).toEqual({ x: 1 });
  });

  it("names every command that owns an option it rejects", () => {
    const flag = { flags: ["--x"], name: "x", value: 1, description: "" };
    const table = [
      { name: "a", description: "", run, default: true },
      { name: "b", description: "", run, flags: [flag] },
      { name: "c", description: "", run, flags: [flag] },
    ];

    expect(() => parseArgs(["--x"], table)).toThrow('Option "--x" only applies to "b" and "c".');
  });

  it("returns the name of an unknown command", () => {
    const result = parse("frobnicate");

    expect(result.name).toBe("frobnicate");
    expect(result.command).toBeUndefined();
  });

  it("rejects an option on a command that does not own it", () => {
    expect(() => parse("install", "--bail")).toThrow('Option "--bail" only applies to "staged".');
    expect(() => parse("--bail", "uninstall")).toThrow('only applies to "staged"');
  });

  it("rejects unknown options, extra arguments and a missing path", () => {
    expect(() => parse("staged", "--nope")).toThrow('Unknown option "--nope".');
    expect(() => parse("staged", "extra")).toThrow('Unexpected argument "extra".');
    expect(() => parse("install", "--config")).toThrow('Option "--config" needs a path.');
  });
});
