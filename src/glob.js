// A small glob matcher in the style of picomatch/bash with `globstar` and `extglob`:
// `*`, `?`, `**`, `[abc]`, `[!a-z]`, `[[:digit:]]`, `{a,b}`, `{1..3}` and the `?() *() +() @() !()`
// groups. Dotfiles match like any other file. Paths use forward slashes.

const POSIX_CLASSES = {
  alpha: "a-zA-Z",
  digit: "0-9",
  alnum: "a-zA-Z0-9",
  upper: "A-Z",
  lower: "a-z",
  word: "\\w",
  space: "\\s",
  blank: " \\t",
  xdigit: "0-9a-fA-F",
  punct: "!-\\/:-@\\[-`{-~",
};
const MAX_RANGE = 1000;

/** Escape a character that is special in a RegExp. */
const escapeChar = (char) => char.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

/** The index of the `]` that closes the bracket expression at `start`, or -1. */
function bracketEnd(str, start) {
  let pos = start + 1;
  if (str[pos] === "!" || str[pos] === "^") pos++;
  if (str[pos] === "]") pos++; // a first `]` is a literal
  for (; pos < str.length; pos++) {
    if (str[pos] === "\\") {
      pos++;
    } else if (str[pos] === "[" && str[pos + 1] === ":") {
      const end = str.indexOf(":]", pos + 2);
      if (end !== -1) pos = end + 1;
    } else if (str[pos] === "]") {
      return pos;
    }
  }
  return -1;
}

/** The index of the `close` that matches the `open` at `start`, or -1. */
function findClosing(str, start, open, close) {
  let depth = 0;
  for (let pos = start; pos < str.length; pos++) {
    const char = str[pos];
    if (char === "\\") {
      pos++;
    } else if (char === "[") {
      const end = bracketEnd(str, pos);
      if (end !== -1) pos = end;
    } else if (char === open) {
      depth++;
    } else if (char === close && --depth === 0) {
      return pos;
    }
  }
  return -1;
}

/** Split at `separator`, but not inside nested groups, braces or brackets. */
function splitTop(str, separator) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let pos = 0; pos < str.length; pos++) {
    const char = str[pos];
    if (char === "\\") {
      pos++;
    } else if (char === "[") {
      const end = bracketEnd(str, pos);
      if (end !== -1) pos = end;
    } else if (char === "(" || char === "{") {
      depth++;
    } else if (char === ")" || char === "}") {
      depth--;
    } else if (char === separator && depth === 0) {
      parts.push(str.slice(last, pos));
      last = pos + 1;
    }
  }
  parts.push(str.slice(last));
  return parts;
}

/** Expand `{a,b}` and `{1..3}` into every pattern they stand for. A lone `{a}` stays as it is. */
function expandBraces(str, from = 0) {
  for (let pos = from; pos < str.length; pos++) {
    const char = str[pos];
    if (char === "\\") {
      pos++;
    } else if (char === "[") {
      const end = bracketEnd(str, pos);
      if (end !== -1) pos = end;
    } else if (char === "{") {
      const end = findClosing(str, pos, "{", "}");
      if (end === -1) continue;

      const body = str.slice(pos + 1, end);
      const parts = splitTop(body, ",");
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(body);
      let alternatives;
      if (parts.length > 1) {
        alternatives = parts;
      } else if (range && Math.abs(range[2] - range[1]) <= MAX_RANGE) {
        const [first, last] = [Number(range[1]), Number(range[2])];
        const step = first <= last ? 1 : -1;
        alternatives = [];
        for (let n = first; step > 0 ? n <= last : n >= last; n += step)
          alternatives.push(String(n));
      } else {
        pos = end;
        continue;
      }

      const before = str.slice(0, pos);
      const after = str.slice(end + 1);
      return alternatives.flatMap((alt) => expandBraces(before + alt + after, pos));
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
    } else if (char === "[" && chars[pos + 1] === ":" && chars.indexOf(":]", pos + 2) !== -1) {
      const end = chars.indexOf(":]", pos + 2);
      set += POSIX_CLASSES[chars.slice(pos + 2, end)] ?? "";
      pos = end + 1;
    } else {
      set += "]^\\[".includes(char) ? `\\${char}` : char;
    }
  }
  return `[${negate ? "^/" : ""}${set}]`;
}

/**
 * The RegExp source of one pattern without braces.
 * @param {string} pattern
 * @param {boolean} [top] false inside a group, where `**` is only a `*`
 */
function compile(pattern, top = true) {
  let out = "";
  for (let pos = 0; pos < pattern.length; pos++) {
    const char = pattern[pos];

    if (char === "\\") {
      out += pos + 1 < pattern.length ? escapeChar(pattern[++pos]) : "\\\\";
      continue;
    }

    if ("?*+@!".includes(char) && pattern[pos + 1] === "(") {
      const end = findClosing(pattern, pos + 1, "(", ")");
      if (end !== -1) {
        const body = pattern.slice(pos + 2, end);
        const alternatives = splitTop(body, "|")
          .map((alt) => compile(alt, false))
          .join("|");
        if (char === "!") {
          // Not the alternatives followed by the rest of the pattern, up to its end.
          const rest = compile(pattern.slice(end + 1), false);
          return `${out}(?:(?!(?:${alternatives})${rest}${top ? "$" : "(?=/|$)"})[^/]*?)${rest}`;
        }
        out += `(?:${alternatives})${{ "?": "?", "*": "*", "+": "+", "@": "" }[char]}`;
        pos = end;
        continue;
      }
    }

    if (char === "/") {
      if (top && pattern.startsWith("/**", pos) && pos + 3 === pattern.length) {
        out += "(?:/.*)?"; // `a/**` also matches `a`
        pos += 2;
      } else {
        out += "/";
      }
    } else if (char === "*") {
      let end = pos + 1;
      while (pattern[end] === "*") end++;
      const segmentStart = top && (pos === 0 || pattern[pos - 1] === "/");
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
    } else if (char === "[") {
      const end = bracketEnd(pattern, pos);
      if (end === -1) {
        out += "\\[";
      } else {
        out += bracket(pattern.slice(pos + 1, end));
        pos = end;
      }
    } else {
      out += escapeChar(char);
    }
  }
  return out;
}

/**
 * Convert a glob to an anchored RegExp.
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
