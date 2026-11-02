const GLOBSTAR = "((?:[^/]*(?:/|$))*)";
const WILDCARD = "([^/]*)";
const CHAR_CLASSES = { alnum: "(\\w|\\d)", space: "\\s", digit: "\\d" };

/**
 * Convert an extended glob (braces, ranges, `@()`, `!()`, `?()`, `*()` and `+()` groups)
 * to an anchored RegExp. Without `globstar`, `*` matches across directories.
 * @param {string} glob
 * @param {{ globstar?: boolean }} [options]
 * @returns {RegExp}
 */
export function globToRegex(glob, { globstar = false } = {}) {
  const stack = [];
  let inRange = false;
  let inGroup = false;
  let regex = "";

  for (let pos = 0; pos < glob.length; pos++) {
    const char = glob[pos];
    const next = glob[pos + 1];

    switch (char) {
      case "\\":
      case "$":
      case "^":
      case "=":
      case ".":
        regex += `\\${char}`;
        break;

      case "/":
        regex += next === "/" ? "\\/?" : "\\/";
        break;

      case "(":
      case "|":
        regex += stack.length ? char : `\\${char}`;
        break;

      case ")": {
        if (!stack.length) {
          regex += "\\)";
          break;
        }
        const type = stack.pop();
        regex += type === "@" ? "){1}" : type === "!" ? ")([^/]*)" : `)${type}`;
        break;
      }

      case "+":
      case "@":
        if (next === "(") stack.push(char);
        else regex += `\\${char}`;
        break;

      case "!":
        if (inRange) {
          regex += "^";
        } else if (next === "(") {
          stack.push(char);
          regex += "(?!";
          pos++;
        } else {
          regex += "\\!";
        }
        break;

      case "?":
        if (next === "(") stack.push(char);
        else regex += ".";
        break;

      case "[": {
        const end = inRange && next === ":" ? glob.indexOf(":", pos + 2) : -1;
        if (end === -1) {
          inRange = true;
          regex += char;
        } else {
          regex += CHAR_CLASSES[glob.slice(pos + 2, end)] ?? "";
          pos = end + 1; // skip the closing "]"
        }
        break;
      }

      case "]":
        inRange = false;
        regex += char;
        break;

      case "{":
        inGroup = true;
        regex += "(";
        break;

      case "}":
        inGroup = false;
        regex += ")";
        break;

      case ",":
        regex += inGroup ? "|" : "\\,";
        break;

      case "*": {
        if (next === "(") {
          stack.push(char);
          break;
        }

        const prev = glob[pos - 1];
        let stars = 1;
        while (glob[pos + 1] === "*") {
          stars++;
          pos++;
        }
        const after = glob[pos + 1];

        if (!globstar) {
          regex += ".*";
        } else if (
          stars > 1 &&
          (prev === "/" || prev === undefined) &&
          (after === "/" || after === undefined)
        ) {
          regex += GLOBSTAR;
          pos++; // swallow the slash after `**`
        } else {
          regex += WILDCARD;
        }
        break;
      }

      default:
        regex += char;
    }
  }

  return new RegExp(`^${regex}$`);
}
