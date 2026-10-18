// Liveness of the indexer walk + gitignore pre-scan (change: bound-kb-search-freshness,
// test-plan #P3, #P4; K1: max event-loop delay <= 250 ms). Scaled-down trees; the
// full-scale numbers are recorded once in design.md (K3).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexSource, WALK_YIELD_EVERY } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { withEventLoopLag } from "./helpers/event-loop-lag.js";
import { makeDeepTree, makeWideDir } from "./helpers/synthetic-tree.js";

const MAX_LAG_MS = 250;
let d: string;
let store: SqliteFtsStore;
beforeEach(() => {
  d = mkdtempSync(join(tmpdir(), "kb-walkyield-"));
  mkdirSync(join(d, "docs"));
  store = new SqliteFtsStore(join(d, ".kb.db"));
  store.init();
});
afterEach(() => {
  store.close();
  rmSync(d, { recursive: true, force: true });
});

describe("walk + gitignore pre-scan yield to the event loop (P3, P4)", () => {
  it("P3: a pass over >= 2 x WALK_YIELD_EVERY directories lets a 10 ms timer fire and keeps lag bounded", async () => {
    const docs = join(d, "docs");
    const { dirs, selected } = makeDeepTree(docs, { groups: 40, perGroup: 60, ignoredEvery: 5 });
    expect(dirs).toBeGreaterThanOrEqual(2 * WALK_YIELD_EVERY);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    try {
      const { result, maxDelayMs } = await withEventLoopLag(() => indexSource(store, { root: "t", dir: docs }, { cwd: d }));
      expect(result.scanned).toBe(selected);
      expect(ticks).toBeGreaterThanOrEqual(1);
      expect(maxDelayMs).toBeLessThanOrEqual(MAX_LAG_MS);
    } finally {
      clearInterval(timer);
    }
  });

  it("P4: one wide directory (~10k direct entries, the R10 residual) completes with bounded lag", async () => {
    const docs = join(d, "docs");
    makeWideDir(join(docs, "wide"), 10_000);
    const { result, maxDelayMs } = await withEventLoopLag(() => indexSource(store, { root: "t", dir: docs }, { cwd: d }));
    expect(result.scanned).toBe(0);
    expect(maxDelayMs).toBeLessThanOrEqual(MAX_LAG_MS);
  });
});
