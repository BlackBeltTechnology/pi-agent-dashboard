import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runIndexAtomic, sweepOrphanTemps } from "../index-run.js";
import { SqliteFtsStore } from "../sqlite-store.js";

let root: string;
let dbPath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-atom-"));
  dbPath = join(root, ".pi/dashboard/kb/index.db");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function docs(name = "docs", file = "a.md"): string {
  const d = join(root, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, file), "# Title\n\nBody long enough to be a real chunk of content for the index to store here now.");
  return d;
}
function countChunks(): number {
  const store = new SqliteFtsStore(dbPath);
  store.init();
  try {
    return store.counts().chunks;
  } finally {
    store.close();
  }
}

describe("kb index atomicity (§1, §2)", () => {
  it("§1.1 all configured sources missing → throws AND leaves no dbPath husk", async () => {
    await expect(
      runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: join(root, "nope") }, { id: "x", dir: join(root, "gone") }] }),
    ).rejects.toThrow();
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}.tmp-${process.pid}`)).toBe(false);
  });

  it("§1.2 mid-run throw after store open (source is a file → ENOTDIR) leaves no committed dbPath", async () => {
    const f = join(root, "notadir.md");
    writeFileSync(f, "x");
    await expect(runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: f }] })).rejects.toThrow();
    expect(existsSync(dbPath)).toBe(false);
  });

  it("§1.3/N2 successful index of a present source set with no markdown writes a valid dbPath (empty ≠ uninitialized)", async () => {
    const d = join(root, "empty");
    mkdirSync(d, { recursive: true });
    const stats = await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }] });
    expect(existsSync(dbPath)).toBe(true);
    expect(stats.chunks).toBe(0);
    expect(countChunks()).toBe(0);
  });

  it("§2.1/2.4 happy path writes dbPath with a non-zero chunk count and no leftover temp", async () => {
    const d = docs();
    const stats = await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }] });
    expect(existsSync(dbPath)).toBe(true);
    expect(stats.chunks).toBeGreaterThan(0);
    expect(existsSync(`${dbPath}.tmp-${process.pid}`)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
  });

  it("§2.3/2.4 a failed incremental run leaves the prior valid DB queryable", async () => {
    const d = docs();
    await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }] });
    const before = countChunks();
    expect(before).toBeGreaterThan(0);
    const f = join(root, "bad.md");
    writeFileSync(f, "x");
    await expect(
      runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }, { id: "bad", dir: f }] }),
    ).rejects.toThrow();
    expect(existsSync(dbPath)).toBe(true);
    expect(countChunks()).toBeGreaterThan(0);
  });

  it("§2.5 sweeps a stale orphan temp on the next run", async () => {
    const d = docs();
    mkdirSync(join(root, ".pi/dashboard/kb"), { recursive: true });
    const orphan = `${dbPath}.tmp-99999`;
    writeFileSync(orphan, "stale");
    await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }] });
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("§2.5 sweep skips a temp whose PID is a live process (concurrent peer)", () => {
    mkdirSync(join(root, ".pi/dashboard/kb"), { recursive: true });
    const live = `${dbPath}.tmp-${process.pid}`; // our own pid = definitely alive
    const dead = `${dbPath}.tmp-99999`;
    writeFileSync(live, "peer-active");
    writeFileSync(dead, "stale");
    sweepOrphanTemps(dbPath);
    expect(existsSync(live)).toBe(true); // live peer's temp preserved
    expect(existsSync(dead)).toBe(false); // stale orphan removed
  });
});

describe("missing source semantics (§3)", () => {
  it("§3.1/3.3 one missing config source among two → indexes the present one, warns, exit ok", async () => {
    const d = docs();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stats = await runIndexAtomic({ dbPath, sources: [{ id: "docs", dir: d }, { id: "gone", dir: join(root, "gone") }] });
    expect(stats.chunks).toBeGreaterThan(0);
    expect(existsSync(dbPath)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("§3.2 explicit --source with a missing dir → error, no dbPath", async () => {
    await expect(
      runIndexAtomic({ dbPath, sources: [{ id: "x", dir: join(root, "missing") }], explicit: true }),
    ).rejects.toThrow();
    expect(existsSync(dbPath)).toBe(false);
  });
});

describe("async walk keeps batch atomicity (bound-kb-search-freshness, X9)", () => {
  it("X9: a throw after the async walk rolls the open batch back; prior batches persist; a rerun is idempotent", async () => {
    const d = join(root, "docs");
    mkdirSync(d, { recursive: true });
    for (let i = 0; i < 130; i++) writeFileSync(join(d, `f${String(i).padStart(3, "0")}.md`), `# T${i}\n\nBody number ${i} long enough to be a real chunk of content for the index to store here now.`);
    const store = new SqliteFtsStore(dbPath);
    store.init();
    try {
      const { indexSource } = await import("../indexer.js");
      let inserts = 0;
      const realInsert = store.insertChunk.bind(store);
      store.insertChunk = ((c: Parameters<typeof realInsert>[0]) => {
        if (++inserts === 120) throw new Error("boom mid-batch"); // batch 2 (files 101..130) is open
        return realInsert(c);
      }) as typeof store.insertChunk;
      await expect(indexSource(store, { root: "t", dir: d })).rejects.toThrow("boom mid-batch");
      const afterThrow = store.listPaths("t").length;
      expect(afterThrow).toBeGreaterThan(0); // batch 1 committed
      expect(afterThrow).toBeLessThan(130); // batch 2 rolled back
      store.insertChunk = realInsert;
      const rerun = await indexSource(store, { root: "t", dir: d });
      expect(store.listPaths("t").length).toBe(130);
      const again = await indexSource(store, { root: "t", dir: d });
      expect(again.changed).toBe(0);
      expect(rerun.changed).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});
