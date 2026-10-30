// Based on nano-staged (MIT) https://github.com/usmanyunusov/nano-staged
import { styleText } from "util";

import { highlight, symbols } from "../log.js";
import { NanoStagedError, TaskRunnerError } from "./errors.js";

export function createReporter(stream = process.stderr) {
  function print(lines) {
    stream.write(lines);
  }

  const reporter = {
    error(err) {
      if (err instanceof NanoStagedError) {
        const msg = highlight(err.message);

        if (["noFiles", "noMatchingFiles"].includes(err.type)) {
          print(`${symbols.info} ${msg}\n`);
        } else {
          print(`${symbols.fail} ${styleText("red", msg)}\n`);
        }
      } else if (err instanceof TaskRunnerError) {
        print(`\n${err.message || err}\n`);
      } else {
        print(`\n${styleText("red", err.message || err)}\n`);
      }
    },
  };

  return reporter;
}
