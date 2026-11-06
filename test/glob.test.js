import { describe, expect, it } from "vitest";
import { createMatcher } from "../src/glob.js";

const matches = (glob, file) => createMatcher(glob)(file);

describe("createMatcher", () => {
  it("matches the file name at any depth when the pattern has no slash", () => {
    expect(matches("*.js", "src/deep/a.js")).toBe(true);
    expect(matches("*.js", "a.css")).toBe(false);
  });

  it("keeps * inside one directory when the pattern has a slash", () => {
    expect(matches("src/*.js", "src/deep/a.js")).toBe(false);
    expect(matches("src/*.js", "src/a.js")).toBe(true);
  });

  it("matches ** across any number of directories", () => {
    expect(matches("src/**/*.js", "src/a.js")).toBe(true);
    expect(matches("src/**/*.js", "src/x/y/a.js")).toBe(true);
    expect(matches("src/**/*.js", "lib/a.js")).toBe(false);
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

  it("matches dotfiles and dot directories", () => {
    expect(matches("*", ".gitignore")).toBe(true);
    expect(matches("*.js", ".eslintrc.js")).toBe(true);
    expect(matches(".github/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matches("src/**/*.js", "src/.hidden/a.js")).toBe(true);
  });

  it("expands nested braces and numeric ranges", () => {
    expect(matches("src/{a,b/{c,d}}.js", "src/b/d.js")).toBe(true);
    expect(matches("src/{a,b/{c,d}}.js", "src/b/e.js")).toBe(false);
    expect(matches("v{1..3}.js", "v2.js")).toBe(true);
    expect(matches("v{1..3}.js", "v4.js")).toBe(false);
    expect(matches("{a}.js", "{a}.js")).toBe(true);
  });

  it("supports + and * groups and escapes", () => {
    expect(matches("+(a|b).js", "abab.js")).toBe(true);
    expect(matches("*(a).js", ".js")).toBe(true);
    expect(matches("a\\*.js", "a*.js")).toBe(true);
    expect(matches("a\\*.js", "ab.js")).toBe(false);
  });

  it("matches a trailing ** and an unclosed bracket", () => {
    expect(matches("src/**", "src/a/b.js")).toBe(true);
    expect(matches("src/**", "lib/a.js")).toBe(false);
    expect(matches("a[b.js", "a[b.js")).toBe(true);
  });

  it("treats characters that are special in a RegExp literally", () => {
    expect(matches("a+b.js", "a+b.js")).toBe(true);
    expect(matches("a.js", "abjs")).toBe(false);
  });
});
