import { basename, posix } from "node:path";

/** Drop the leading dot of every path segment, so `*` can match dotfiles as a shell would not. */
const withoutDots = (file) =>
  file
    .split("/")
    .map((segment) => segment.replace(/^\.+(?=.)/, ""))
    .join("/");

/**
 * Build a matcher for a glob, using `path.matchesGlob` of Node. A pattern without a slash
 * matches the file name at any depth, so `*.js` matches `src/a.js`. Dotfiles match `*`.
 * @param {string} glob
 * @returns {(file: string) => boolean} takes a path with forward slashes
 */
export function createMatcher(glob) {
  const anyDepth = !glob.includes("/");
  const matchesGlob = (file) => posix.matchesGlob(file, glob);
  return (file) => {
    const target = anyDepth ? basename(file) : file;
    return matchesGlob(target) || matchesGlob(withoutDots(target));
  };
}
