import { describe, expect, it } from "vitest";
import { COMMANDS, STAGED_OPTIONS, parseArgs } from "../src/args.js";
import { SETTINGS } from "../src/config.js";
import { HELP } from "../src/help.js";

const parse = (...argv) => parseArgs(argv);

describe("parseArgs", () => {
  it("runs install when no command is given", () => {
    expect(parse().command).toBe("install");
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
    expect(parse("--no-restage", "staged").options).toEqual({ restage: false });
  });

  it("takes the hook name for run", () => {
    const { command, args, options } = parse("run", "-c", "a.json", "commit-msg");

    expect(command).toBe("run");
    expect(args).toEqual(["commit-msg"]);
    expect(options).toEqual({ config: "a.json" });
  });

  it("returns the help and version actions as soon as it sees their option", () => {
    expect(parse("staged", "-h").action).toBe("help");
    expect(parse("-v").action).toBe("version");
  });

  it("returns help over an unknown command", () => {
    expect(parse("frobnicate", "-h").action).toBe("help");
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
    expect(() => parse("staged", "--nope")).toThrow("Unknown option '--nope'");
    expect(() => parse("staged", "extra")).toThrow('Unexpected argument "extra".');
    expect(() => parse("run", "pre-push", "extra")).toThrow('Unexpected argument "extra".');
    expect(() => parse("install", "--config")).toThrow("argument missing");
    expect(() => parse("install", "--config", "--bail")).toThrow("ambiguous");
  });
});

describe("the command line and the configuration", () => {
  it("has an option of staged for each setting of the configuration", () => {
    const keys = Object.values(STAGED_OPTIONS).map(([key]) => key);

    expect(keys.toSorted()).toEqual(SETTINGS.toSorted());
  });
});

describe("the help text", () => {
  it("names every command and every option", () => {
    for (const command of COMMANDS) expect(HELP).toContain(`  ${command}`);
    for (const option of [
      ...Object.keys(STAGED_OPTIONS).map((n) => `--${n}`),
      "--config",
      "--version",
      "--help",
    ]) {
      expect(HELP).toContain(option);
    }
  });
});
