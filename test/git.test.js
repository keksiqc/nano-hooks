import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createGit } from "../src/lib/git.js";
import { testRepo } from "./helpers.js";

describe("snapshotIndex", () => {
  it("puts the snapshot back over the index it came from", async () => {
    const r = testRepo({ "a.js": "one\n" });
    const path = join(r.dir, ".git", "snapshot");
    const staged = r.git("ls-files", "--stage");

    const snapshot = await createGit(r.dir).snapshotIndex(path);
    r.write("b.js", "two\n");
    r.git("add", "b.js");
    snapshot.restore();

    expect(r.git("ls-files", "--stage")).toBe(staged);
  });

  it("leaves an existing file alone when it cannot write the snapshot", async () => {
    const r = testRepo({ "a.js": "one\n" });
    const path = join(r.dir, ".git", "snapshot");
    writeFileSync(path, "another run");

    await expect(createGit(r.dir).snapshotIndex(path)).rejects.toThrow("EEXIST");

    expect(readFileSync(path, "utf8")).toBe("another run");
  });

  it("leaves no snapshot behind when it cannot make the copy independent", async () => {
    const r = testRepo({ "a.js": "one\n" });
    const path = join(r.dir, ".git", "snapshot");
    writeFileSync(join(r.dir, ".git", "index"), "not an index");

    await expect(createGit(r.dir).snapshotIndex(path)).rejects.toThrow(/index/iu);

    expect(existsSync(path)).toBe(false);
  });

  it("keeps the snapshot when the restore fails", async () => {
    const r = testRepo({ "a.js": "one\n" });
    const path = join(r.dir, ".git", "snapshot");
    const snapshot = await createGit(r.dir).snapshotIndex(path);
    writeFileSync(join(r.dir, ".git", "index.lock"), "other writer");

    expect(() => snapshot.restore()).toThrow("EEXIST");

    expect(existsSync(path)).toBe(true);
    expect(readFileSync(join(r.dir, ".git", "index.lock"), "utf8")).toBe("other writer");
  });
});
