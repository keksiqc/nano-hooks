// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
const REG_STR = /([^\s'"]([^\s'"]*(['"])([^\3]*?)\3)+[^\s'"]*)|[^\s'"]+|(['"])([^\5]*?)\5/gi;

export function toArray(val) {
  return Array.isArray(val) ? val : [val];
}

export function stringArgvToArray(str = "") {
  let args = [];
  let match;

  while (true) {
    match = REG_STR.exec(str);

    if (!match) {
      return args;
    }

    for (let arg of [match[1], match[6], match[0]]) {
      if (typeof arg === "string") {
        args.push(arg);
      }
    }
  }
}
