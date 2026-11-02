import { describe, expect, it } from "vitest";
import { splitCommand } from "../src/tasks.js";

describe("splitCommand", () => {
  it("splits on whitespace", () => {
    expect(splitCommand("prettier --write  --cache")).toEqual(["prettier", "--write", "--cache"]);
  });

  it("keeps quoted text together, once", () => {
    expect(splitCommand(`echo "a b" 'c d'`)).toEqual(["echo", "a b", "c d"]);
    expect(splitCommand(`run --name="a b"`)).toEqual(["run", `--name="a b"`]);
  });
});
