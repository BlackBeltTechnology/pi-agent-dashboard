// A batch must not fail when ANOTHER connection commits between the batch's first read and its first
// write. With a deferred `BEGIN`, the read pins a WAL snapshot; the later write cannot upgrade a stale
// snapshot and SQLite returns SQLITE_BUSY ("database is locked") at once — `busy_timeout` never applies.
// Seen live: dashboard reindex vs. a pi session's freshness pass on the same index file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";

let d: string;
beforeEach(() => {
  d = mkdtempSync(join(tmpdir(), "kb-concurrent-"));
});
afterEach(() => rmSync(d, { recursive: true, force: true }));

it("a batch survives another writer committing between its read and its write", async () => {
  const docs = join(d, "docs");
  mkdirSync(docs);
  writeFileSync(join(docs, "a.md"), "# A\n\nalpha\n");
  writeFileSync(join(docs, "b.md"), "# B\n\nbeta\n");
  const dbPath = join(d, "kb.db");
  const store = new SqliteFtsStore(dbPath);
  store.init();
  const other = new SqliteFtsStore(dbPath, { busyTimeoutMs: 0 });
  try {
    await indexSource(store, { root: "docs", dir: docs }, {});
    // Second pass: a.md is unchanged (read only), b.md changed (read → write).
    writeFileSync(join(docs, "b.md"), "# B\n\nbeta changed\n");
    let file = 0;
    const stats = await indexSource(store, { root: "docs", dir: docs }, {
      heartbeat: () => {
        if (++file !== 2) return;
        // The other writer commits after a.md's read. Under BEGIN IMMEDIATE it cannot get the
        // lock (same thread, timeout 0) and fails instead — that is the serialization we want.
        try {
          other.setFileState("other", "x.md", { mtimeMs: 1, sha256: "x" });
        } catch { /* lock held by the batch */ }
      },
    });
    expect(stats.changed).toBe(1);
  } finally {
    other.close();
    store.close();
  }
});
