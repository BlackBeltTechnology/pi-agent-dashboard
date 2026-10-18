// Seed failure containment. See change: add-kb-worktree-seed (test-plan X1–X4).
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SqliteFtsStore } from "../sqlite-store.js";

const h = vi.hoisted(() => ({ calls: 0, fail: null as null | ((n: number) => boolean) }));
vi.mock("../indexer.js", async (orig) => {
  const m = await orig<typeof import("../indexer.js")>();
  return {
    ...m,
    indexSource: async (...args: Parameters<typeof m.indexSource>) => {
      h.calls++;
      if (h.fail?.(h.calls)) throw new Error("injected walk failure");
      return m.indexSource(...args);
    },
  };
});

import { addWorktree, doc, dump, indexAt, mkMain, sameRows, useSeedTree, writeFile } from "./helpers/seed-fixture.js";

const t = useSeedTree();
const dbOf = (cwd: string) => join(cwd, ".pi/dashboard/kb/index.db");
const refDb = () => join(t.tmp, "ref.db");
const leftovers = (wt: string) => readdirSync(join(wt, ".pi/dashboard/kb")).filter((f) => f.includes(".tmp-"));

async function prepared() {
  mkMain(t);
  h.fail = null;
  await indexAt(t.main);
  const wt = addWorktree(t);
  writeFile(wt, "docs/d0.md", doc(0, 30, "edited"));
  h.calls = 0;
  return wt;
}

describe("seed failure reruns unseeded", () => {
  it("X1 a main database that is not a database: snapshot-error, equal to unseeded, no tmp left", async () => {
    mkMain(t);
    h.fail = null;
    writeFile(t.main, ".pi/dashboard/kb/index.db", "garbage".repeat(600));
    const wt = addWorktree(t);
    const r = await indexAt(wt);
    expect(r.lines).toEqual(["[kb] seed-skipped=snapshot-error"]);
    await indexAt(wt, { dbPath: refDb(), noSeed: true });
    sameRows(dump(dbOf(wt)), dump(refDb()));
    expect(leftovers(wt)).toEqual([]);
  });

  it("X2 a throw in the seeded walk reruns once unseeded", async () => {
    const wt = await prepared();
    h.fail = (n) => n === 1; // the first walk call is the seeded run's first source
    const r = await indexAt(wt);
    expect(r.lines).toEqual(["[kb] seed-skipped=snapshot-error"]);
    expect(h.calls).toBe(3); // 1 failed seeded call + the rerun's 2 sources
    h.fail = null;
    await indexAt(wt, { dbPath: refDb(), noSeed: true });
    sameRows(dump(dbOf(wt)), dump(refDb()));
    expect(leftovers(wt)).toEqual([]);
  });

  it("X3 a failing rerun fails the run and leaves no database or tmp", async () => {
    const wt = await prepared();
    h.fail = () => true;
    await expect(indexAt(wt)).rejects.toThrow(/injected walk failure/);
    expect(readdirSync(join(wt, ".pi/dashboard")).includes("kb") ? readdirSync(join(wt, ".pi/dashboard/kb")) : []).toEqual([]);
    h.fail = null;
  });

  it("X4 a leftover same-PID tmp and sidecars never leak foreign rows into the seed", async () => {
    const wt = await prepared();
    const db = dbOf(wt);
    const tmp = `${db}.tmp-${process.pid}`;
    const foreign = new SqliteFtsStore(tmp);
    foreign.init();
    foreign.setFileState("foreign", "z.md", { mtimeMs: 1, sha256: "z" });
    foreign.insertChunk({ root: "foreign", path: "z.md", chunkId: "c", headingPath: "Z", heading: "Z", level: 1, parentChunkId: null, docType: "doc", body: "FOREIGNROW", bodyHash: "b" });
    foreign.close();
    writeFileSync(`${tmp}-wal`, "junk");
    writeFileSync(`${tmp}-shm`, "junk");
    const r = await indexAt(wt);
    expect(r.lines[0]).toMatch(/^\[kb\] seed=/);
    expect(dump(db).chunks.some((c) => c.includes("FOREIGNROW"))).toBe(false);
    expect(dump(db).files.some((f) => f.startsWith("foreign|"))).toBe(false);
  });
});
