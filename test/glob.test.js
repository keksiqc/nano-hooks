import { describe, expect, it } from "vitest";
import { globToRegex } from "../src/glob.js";

const matches = (glob, file, options) => globToRegex(glob, options).test(file);

describe("globToRegex", () => {
  it("lets * cross directories unless globstar is on", () => {
    expect(matches("*.js", "src/deep/a.js")).toBe(true);
    expect(matches("src/*.js", "src/deep/a.js", { globstar: true })).toBe(false);
    expect(matches("src/*.js", "src/a.js", { globstar: true })).toBe(true);
  });

  it("matches ** across any number of directories", () => {
    const options = { globstar: true };
    expect(matches("src/**/*.js", "src/a.js", options)).toBe(true);
    expect(matches("src/**/*.js", "src/x/y/a.js", options)).toBe(true);
    expect(matches("src/**/*.js", "lib/a.js", options)).toBe(false);
  });

  it("supports braces and character ranges", () => {
    expect(matches("*.{js,ts}", "a.ts")).toBe(true);
    expect(matches("*.{js,ts}", "a.css")).toBe(false);
    expect(matches("[!a]b.js", "cb.js")).toBe(true);
    expect(matches("[!a]b.js", "ab.js")).toBe(false);
    expect(matches("[[:digit:]].js", "1.js")).toBe(true);
  });

  it("supports extended groups", () => {
    expect(matches("@(a|b).js", "b.js")).toBe(true);
    expect(matches("!(a).js", "b.js")).toBe(true);
    expect(matches("!(a).js", "a.js")).toBe(false);
    expect(matches("a?(b).js", "a.js")).toBe(true);
  });

  it("escapes characters that are special in a RegExp", () => {
    expect(matches("a+b.js", "a+b.js")).toBe(true);
    expect(matches("a.js", "abjs")).toBe(false);
    expect(matches("(a).js", "(a).js")).toBe(true);
  });
});
