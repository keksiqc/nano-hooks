import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** The real path of `path`. A part that does not exist yet keeps its name. */
export function realPath(path) {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : resolve(realPath(parent), basename(path));
  }
}

/** Whether `child` is `parent` or below it. */
export const isInside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};

/** The path with forward slashes, as git and the glob matcher write it. */
export const toPosix = (path) => path.replaceAll("\\", "/");
