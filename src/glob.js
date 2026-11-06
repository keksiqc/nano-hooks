// A tiny glob matcher in the style of picomatch, without dependencies.
// Supported: `*`, `?`, `**`, `[abc]`, `[!a-z]`, `{a,b}` (also nested) and `\` escapes.
// Not supported: extglob groups like `!(a)` or `+(a|b)`. They throw, because a group that
// repeats can make a RegExp backtrack without limit. Dotfiles match like any other file.

/** Escape a character that is special in a RegExp. */
const escapeChar = (char) => char.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

/** The index of the `]` that closes the bracket expression at `start`, or -1. */
function bracketEnd(str, start) {
  let pos = start + 1;
  if (str[pos] === "!" || str[pos] === "^") pos++;
  if (str[pos] === "]") pos++; // a first `]` is a literal
  for (; pos < str.length; pos++) {
    if (str[pos] === "\\") pos++;
    else if (str[pos] === "]") return pos;
  }
  return -1;
}

/** Skip an escape or a bracket expression at `pos`: the index of its last character. */
function skipLiteral(str, pos) {
  if (str[pos] === "\\") return pos + 1;
  const end = bracketEnd(str, pos);
  return end === -1 ? pos : end;
}

/** The index of the `}` that closes the `{` at `start` and the comma separated parts, or null. */
function parseBrace(str, start) {
  const parts = [];
  let depth = 0;
  let last = start + 1;
  for (let pos = start; pos < str.length; pos++) {
    const char = str[pos];
    if (char === "\\" || char === "[") {
      pos = skipLiteral(str, pos);
    } else if (char === "{") {
      depth++;
    } else if (char === "}" && --depth === 0) {
      parts.push(str.slice(last, pos));
      return { end: pos, parts };
    } else if (char === "," && depth === 1) {
      parts.push(str.slice(last, pos));
      last = pos + 1;
    }
  }
  return null;
}

/** Expand `{a,b}` into every pattern it stands for. A brace without a comma stays as it is. */
function expandBraces(str, from = 0) {
  for (let pos = from; pos < str.length; pos++) {
    const char = str[pos];
    if (char === "\\" || char === "[") {
      pos = skipLiteral(str, pos);
    } else if (char === "{") {
      const brace = parseBrace(str, pos);
      if (!brace) continue;
      if (brace.parts.length === 1) {
        pos = brace.end;
        continue;
      }
      const before = str.slice(0, pos);
      const after = str.slice(brace.end + 1);
      return brace.parts.flatMap((part) => expandBraces(before + part + after, pos));
    }
  }
  return [str];
}

/** The RegExp source of a bracket expression, given what is between `[` and `]`. */
function bracket(body) {
  const negate = body[0] === "!" || body[0] === "^";
  const chars = negate ? body.slice(1) : body;
  let set = "";
  for (let pos = 0; pos < chars.length; pos++) {
    const char = chars[pos];
    if (char === "\\" && pos + 1 < chars.length) {
      const escaped = chars[++pos];
      set += /\w/.test(escaped) ? escaped : `\\${escaped}`;
    } else {
      set += "]^\\[".includes(char) ? `\\${char}` : char;
    }
  }
  return `[${negate ? "^/" : ""}${set}]`;
}

/** The RegExp source of one pattern without braces. */
function compile(pattern) {
  let out = "";
  for (let pos = 0; pos < pattern.length; pos++) {
    const char = pattern[pos];

    if (char === "\\") {
      out += pos + 1 < pattern.length ? escapeChar(pattern[++pos]) : "\\\\";
    } else if ("?*+@!".includes(char) && pattern[pos + 1] === "(") {
      throw new Error(
        `"${char}(" groups are not supported: use braces like {a,b}, or escape the ( with a backslash`,
      );
    } else if (char === "/") {
      if (pattern.startsWith("/**", pos) && pos + 3 === pattern.length) {
        out += "(?:/.*)?"; // `a/**` also matches `a`
        pos += 2;
      } else {
        out += "/";
      }
    } else if (char === "*") {
      let end = pos + 1;
      while (pattern[end] === "*") end++;
      const segmentStart = pos === 0 || pattern[pos - 1] === "/";
      if (end - pos > 1 && segmentStart && end === pattern.length) {
        out += ".*";
        pos = end - 1;
      } else if (end - pos > 1 && segmentStart && pattern[end] === "/") {
        out += "(?:[^/]*/)*"; // zero or more directories
        pos = end; // swallow the slash after `**`
      } else {
        out += "[^/]*";
        pos = end - 1;
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[" && bracketEnd(pattern, pos) !== -1) {
      const end = bracketEnd(pattern, pos);
      out += bracket(pattern.slice(pos + 1, end));
      pos = end;
    } else {
      out += escapeChar(char);
    }
  }
  return out;
}

/**
 * Convert a glob to an anchored RegExp. Throws for a group like `!(a)`.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegex(glob) {
  const sources = expandBraces(glob).map((pattern) => compile(pattern));
  return new RegExp(`^(?:${sources.join("|")})$`);
}

/**
 * Build a matcher for a glob. A pattern without a slash matches the file name at any depth,
 * so `*.js` matches `src/a.js`.
 * @param {string} glob
 * @returns {(file: string) => boolean} takes a path with forward slashes
 */
export function createMatcher(glob) {
  const regex = globToRegex(glob);
  const anyDepth = !glob.includes("/");
  return (file) => regex.test(anyDepth ? file.slice(file.lastIndexOf("/") + 1) : file);
}
