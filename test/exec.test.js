import { describe, expect, it } from "vitest";
import { exec, run } from "../src/exec.js";

const node = process.execPath;

describe("exec", () => {
  it("returns exit code and split output", async () => {
    const r = await exec(node, ["-e", "console.log('a');console.error('b')"]);
    expect(r).toMatchObject({ stdout: "a\n", stderr: "b\n", exitCode: 0 });
  });

  it("rejects with details on non-zero exit, unless throwOnError is false", async () => {
    const args = ["-e", "console.log('x');process.exit(3)"];
    await expect(exec(node, args)).rejects.toMatchObject({ exitCode: 3, stdout: "x\n" });
    expect((await exec(node, args, { throwOnError: false })).exitCode).toBe(3);
  });

  it("kills the process on timeout", async () => {
    await expect(exec(node, ["-e", "setTimeout(()=>{},1e5)"], { timeout: 100 })).rejects.toThrow(
      /timed out/,
    );
  });

  it("rejects for a missing command and does not use a shell", async () => {
    await expect(run("definitely-not-a-command-xyz")).rejects.toThrow(/does not exist/);
    expect(await run(node, ["-p", "process.argv[1]", "$(echo hi); ls"])).toBe("$(echo hi); ls\n");
  });

  it("removes env variables set to undefined", async () => {
    const out = await run(node, ["-p", "String(process.env.NH_X)"], {
      env: { NH_X: undefined },
    });
    expect(out).toBe("undefined\n");
  });
});
