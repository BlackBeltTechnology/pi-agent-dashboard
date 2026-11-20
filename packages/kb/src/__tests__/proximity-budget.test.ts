// Tests for change: bound-kb-proximity-search — per-search proximity time budget
// and its single expiry log line (design D2). Folded from
// openspec/changes/bound-kb-proximity-search/test-plan.md (E9 partial expiry,
// E10 zero budget, E11 budget accounting, E12 coercion, F2 contract, X1–X4 log).
// Exemplar: packages/kb/src/__tests__/lane-lead.test.ts (two-lane corpus, raw scores).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import type { KbHit, SearchOpts } from "../types.js";

const Q = "alpha beta gamma";
const DOCS = 8;
const AGENTS = 3;
const WARN_RE = /^\[kb\] proximity budget (\d+)ms exhausted; (\d+) of (\d+) rows scored without proximity$/;

let dir: string;
let store: SqliteFtsStore;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "kb-prox-budget-"));
  // DOCS doc files with a distinct BM25 order (more padding = weaker), every body
  // holding the query terms in order inside a small window (non-zero Δ when boosted).
  for (let i = 0; i < DOCS; i++) {
    writeFileSync(join(dir, `doc-${i}.md`), `# Doc ${i}\n\nalpha beta gamma ${"padding words here ".repeat(i * 4 + 1)}alpha xx beta gamma.\n`);
  }
  // AGENTS records: long bodies, so in the main lane they rank below every doc.
  mkdirSync(join(dir, "src"), { recursive: true });
  for (let i = 0; i < AGENTS; i++) {
    writeFileSync(join(dir, "src", `m${i}.ts.AGENTS.md`), `# m${i}.ts\n\n${"unrelated record prose for the module table. ".repeat(40 + i * 5)}alpha beta gamma mentioned once.\n`);
  }
  store = new SqliteFtsStore(join(dir, ".kb.db"));
  store.init();
  await indexSource(store, { root: "t", dir });
});
afterAll(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());

const plain = (q = Q, o: SearchOpts = {}) => store.search(q, { limit: 20, ...o, proximityBoost: false });
const boosted = (o: Omit<SearchOpts, "proximityBudgetMs"> & { proximityBudgetMs?: unknown }, q = Q) =>
  store.search(q, { limit: 20, ...(o as SearchOpts), proximityBoost: true });
const byId = (hits: KbHit[]) => new Map(hits.map((h) => [h.chunkId, h.score]));
/** chunkIds whose score differs from the plain-BM25 score. */
const boostedIds = (hits: KbHit[], base: KbHit[]) => {
  const b = byId(base);
  return hits.filter((h) => h.score !== b.get(h.chunkId)).map((h) => h.chunkId);
};
/** Fake clock: each proximityDelta call (a before/after pair) measures `perCall`
 *  ms; the gap before each call (dedup/MMR/anything else) is `between` ms. */
function fakeClock(perCall: number, between = 0) {
  let t = 0;
  let n = 0;
  return vi.spyOn(performance, "now").mockImplementation(() => {
    t += n++ % 2 === 0 ? between : perCall;
    return t;
  });
}

describe("corpus preconditions", () => {
  it("doc rows have a distinct BM25 order and every row gains from proximity", () => {
    const off = plain(Q, { laneQuota: 0, sourceDedup: false, dedup: false });
    const docs = off.filter((h) => h.docType !== "agents");
    expect(docs).toHaveLength(DOCS);
    expect(new Set(docs.map((h) => h.score)).size).toBe(DOCS);
    const on = boosted({ laneQuota: 0, sourceDedup: false, dedup: false });
    expect(boostedIds(on, off)).toHaveLength(off.length);
  });
});

describe("E9/E10: budget expiry keeps rows, scores late ones as plain BM25", () => {
  it("E9: 100 ms per call, budget 250 → exactly the first 3 BM25-ordered rows boosted", () => {
    const off = plain(Q, { laneQuota: 0 });
    fakeClock(100);
    const on = boosted({ laneQuota: 0, proximityBudgetMs: 250 });
    vi.restoreAllMocks();
    expect(on).toHaveLength(off.length);
    const first3 = [...off].sort((a, b) => a.score - b.score).slice(0, 3).map((h) => h.chunkId);
    expect(boostedIds(on, off).sort()).toEqual(first3.sort());
  });

  it("E10: budget 0 → every score equals proximityBoost:false", () => {
    const off = plain();
    const on = boosted({ proximityBudgetMs: 0 });
    expect(on.map((h) => [h.path, h.score])).toEqual(off.map((h) => [h.path, h.score]));
  });
});

describe("E11: budget accounting", () => {
  it("between-call time is not charged and the allowance is shared across lanes", () => {
    const off = plain();
    const clock = fakeClock(100, 10_000);
    const on = boosted({ proximityBudgetMs: 250 });
    const calls = clock.mock.calls.length;
    vi.restoreAllMocks();
    expect(calls).toBe(6); // 3 proximity calls in total, both lanes together
    expect(boostedIds(on, off)).toHaveLength(3); // (a) not 0: the 10 s gaps were not charged
    // (b) the agents lane got no allowance of its own: its rows stay plain BM25
    const offScore = byId(off);
    const agents = on.filter((h) => h.docType === "agents");
    expect(agents.length).toBeGreaterThan(0);
    for (const h of agents) expect(h.score).toBe(offScore.get(h.chunkId));
  });
});

describe("E12: proximityBudgetMs coercion", () => {
  const isPlain = (hits: KbHit[]) => boostedIds(hits, plain()).length === 0;
  it.each([-5, 0])("%p ≡ 0 (plain BM25)", (v) => {
    expect(isPlain(boosted({ proximityBudgetMs: v }))).toBe(true);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, "abc", undefined, 60001])("%p ≡ a positive budget (rows boosted)", (v) => {
    expect(() => boosted({ proximityBudgetMs: v })).not.toThrow();
    expect(isPlain(boosted({ proximityBudgetMs: v }))).toBe(false);
  });
  it("60001 clamps to 60000: a 59 999 ms call still leaves budget, a 60 000 ms one does not", () => {
    fakeClock(59_999);
    const a = boosted({ laneQuota: 0, proximityBudgetMs: 60001 });
    vi.restoreAllMocks();
    fakeClock(60_000);
    const b = boosted({ laneQuota: 0, proximityBudgetMs: 60001 });
    vi.restoreAllMocks();
    const off = plain(Q, { laneQuota: 0 });
    expect(boostedIds(a, off)).toHaveLength(2);
    expect(boostedIds(b, off)).toHaveLength(1);
  });
});

describe("F2: contract unchanged", () => {
  it("a degraded search returns the same KbHit shape as proximityBoost:false", () => {
    const off = plain();
    const on = boosted({ proximityBudgetMs: 0 });
    expect(Array.isArray(on)).toBe(true);
    expect(on.length).toBe(off.length);
    on.forEach((h, i) => expect(Object.keys(h).sort()).toEqual(Object.keys(off[i]).sort()));
  });
});

describe("X1–X4: expiry log line", () => {
  it("X1: budget 0 → exactly one warn, counts across both lanes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const on = boosted({ proximityBudgetMs: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    const m = String(warn.mock.calls[0][0]).match(WARN_RE);
    expect(m).not.toBeNull();
    const [, budget, skipped, total] = m!.map(Number);
    expect(budget).toBe(0);
    // main lane scans every row (DOCS + AGENTS); the agents lane re-scans AGENTS
    expect(total).toBe(DOCS + AGENTS + AGENTS);
    expect(skipped).toBe(total);
    expect(boostedIds(on, plain())).toHaveLength(0);
  });

  it("X2: one warn per expiring call, none for a healthy call in between", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deltas: number[] = [];
    for (const budget of [0, undefined, 0]) {
      const before = warn.mock.calls.length;
      boosted({ proximityBudgetMs: budget });
      deltas.push(warn.mock.calls.length - before);
    }
    expect(deltas).toEqual([1, 0, 1]);
  });

  it("X3: no warn when nothing was skipped while proximity applied", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    boosted({});
    store.search(Q, { proximityBoost: false, proximityBudgetMs: 0 });
    boosted({ proximityBudgetMs: 0 }, "alpha");
    expect(warn).not.toHaveBeenCalled();
  });

  it("X4: hostile queries with budget 0 never throw and equal proximityBoost:false", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const q of ['ü" OR x* NEAR(', '"\uD800"', 'közzé"tételek alpha beta']) {
      expect(() => boosted({ proximityBudgetMs: 0 }, q)).not.toThrow();
      expect(boosted({ proximityBudgetMs: 0 }, q).map((h) => [h.path, h.score])).toEqual(plain(q).map((h) => [h.path, h.score]));
    }
    expect(boosted({ proximityBudgetMs: 0 }, "!!! ?? --")).toEqual([]);
  });
});
