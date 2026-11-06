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
    expect(matches("src/**", "src/a/b.js")).toBe(true);
    expect(matches("src/**", "lib/a.js")).toBe(false);
  });

  it("supports ? and character ranges", () => {
    expect(matches("?.js", "a.js")).toBe(true);
    expect(matches("?.js", "ab.js")).toBe(false);
    expect(matches("[a-c]b.js", "bb.js")).toBe(true);
    expect(matches("[!a]b.js", "cb.js")).toBe(true);
    expect(matches("[!a]b.js", "ab.js")).toBe(false);
  });

  it("expands braces, also nested", () => {
    expect(matches("*.{js,ts}", "a.ts")).toBe(true);
    expect(matches("*.{js,ts}", "a.css")).toBe(false);
    expect(matches("src/{a,b/{c,d}}.js", "src/b/d.js")).toBe(true);
    expect(matches("src/{a,b/{c,d}}.js", "src/b/e.js")).toBe(false);
    expect(matches("{a}.js", "{a}.js")).toBe(true);
  });

  it("matches dotfiles and dot directories", () => {
    expect(matches("*", ".gitignore")).toBe(true);
    expect(matches("*.js", ".eslintrc.js")).toBe(true);
    expect(matches(".github/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matches("src/**/*.js", "src/.hidden/a.js")).toBe(true);
  });

  it("treats escaped and special RegExp characters literally", () => {
    expect(matches("a\\*.js", "a*.js")).toBe(true);
    expect(matches("a\\*.js", "ab.js")).toBe(false);
    expect(matches("a+b.js", "a+b.js")).toBe(true);
    expect(matches("a.js", "abjs")).toBe(false);
    expect(matches("a[b.js", "a[b.js")).toBe(true);
    expect(matches("(a).js", "(a).js")).toBe(true);
  });

  it("throws for extglob groups, but not for an escaped one", () => {
    for (const glob of ["!(a).js", "@(a|b).js", "+(a).js", "*(a).js", "?(a).js"]) {
      expect(() => createMatcher(glob)).toThrow("groups are not supported");
    }
    expect(matches("a\\@(b).js", "a@(b).js")).toBe(true);
  });

  it("rejects a repeating group up front instead of backtracking on it", () => {
    expect(() => createMatcher("*(a|aa)b")).toThrow("groups are not supported");
  });
});
