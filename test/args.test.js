import { describe, expect, it } from "vitest";

import { COMMANDS, GLOBAL_OPTIONS, parseArgs } from "../src/args.js";
import { formatHelp } from "../src/help.js";

const parse = (...argv) => parseArgs(argv);

describe("parseArgs", () => {
  it("uses the supplied default when no command is given", () => {
    const { command, options } = parseArgs(["--bail"], "staged");

    expect(command.name).toBe("staged");
    expect(options).toEqual({ bail: true });
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

    expect(command.name).toBe("run");
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

describe("the help text", () => {
  it("names every command and every option", () => {
    const help = formatHelp("uninstall");

    expect(help).toContain("uninstall (default)");
    for (const { name, positionals = [], options = {} } of COMMANDS) {
      const usage = [name, ...positionals.map((argument) => `<${argument.name}>`)].join(" ");
      expect(help).toContain(`  ${usage}`);
      for (const option of Object.keys(options)) expect(help).toContain(`--${option}`);
    }
    for (const option of Object.keys(GLOBAL_OPTIONS)) expect(help).toContain(`--${option}`);
  });
});
