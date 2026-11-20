// Tests for change: bound-kb-proximity-search — exact polynomial proximity window
// (design D1). Folded from openspec/changes/bound-kb-proximity-search/test-plan.md
// (E1 differential vs reference DFS, E2 span BVA, E3 smallest chain, E4 duplicate
// terms, E5 missing term, E6 order matters, E7 <2 terms, E8 greedy early exits).
// Exemplar: packages/kb/src/__tests__/unicode-tokenizer.test.ts (store style).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexSource } from "../indexer.js";
import { minInOrderSpan, proximityDelta, rawTokens, SqliteFtsStore, tokenize } from "../sqlite-store.js";

// --------------------------------------------------------------------------
// Reference oracle: a verbatim copy of the pre-change recursive `walk` DFS,
// with a call budget so a pathological input can never hang the runner.
// --------------------------------------------------------------------------
const ORACLE_BUDGET = 2_000_000;
function oracleSpan(queryTerms: string[], body: string): number {
  const tokens = rawTokens(body);
  const pos: Record<string, number[]> = Object.create(null);
  tokens.forEach((t, i) => { (pos[t] ??= []).push(i); });
  let best = Infinity;
  let calls = 0;
  const qt = queryTerms;
  const walk = (idx: number, start: number, span: number): void => {
    if (++calls > ORACLE_BUDGET) throw new Error("oracle budget exhausted");
    if (idx === qt.length) { best = Math.min(best, span); return; }
    const arr = pos[qt[idx]];
    if (!arr) return;
    for (const p of arr) {
      if (p < start) continue;
      walk(idx + 1, p, idx === 0 ? 0 : span + (p - start));
      if (best === 1) return;
    }
  };
  walk(0, -1, 0);
  return best;
}
function oracleDelta(queryTerms: string[], body: string): number {
  if (queryTerms.length < 2) return 0;
  const best = oracleSpan(queryTerms, body);
  if (!isFinite(best)) return 0;
  const d = -Math.max(0, 2 - best / 20);
  return d === 0 ? 0 : d;
}

// Deterministic PRNG (mulberry32) so a failure is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

describe("E1: differential — greedy vs reference DFS", () => {
  it("20 000 small random pairs (4-token alphabet, duplicate query terms allowed): raw span and delta equal", () => {
    const r = rng(1075);
    const alpha = ["aa", "bb", "cc", "dd"];
    let mismatches = 0;
    for (let i = 0; i < 20_000; i++) {
      const body = Array.from({ length: int(r, 1, 25) }, () => alpha[int(r, 0, 3)]).join(" ");
      const q = Array.from({ length: int(r, 2, 5) }, () => alpha[int(r, 0, 3)]);
      const span = minInOrderSpan(q, body);
      if (span !== oracleSpan(q, body) || !Object.is(proximityDelta(q, body), oracleDelta(q, body))) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("2 000 large-body pairs (64–512 tokens, k = 3–8, duplicates): raw span equal, incl. spans ≥ 40", () => {
    const r = rng(895);
    const terms = ["qa", "qb", "qc", "qd", "qe", "qf"];
    let mismatches = 0;
    let wide = 0;
    for (let i = 0; i < 2_000; i++) {
      const k = int(r, 3, 8);
      const q = Array.from({ length: k }, () => terms[int(r, 0, terms.length - 1)]);
      const n = int(r, 64, 512);
      // Sparse query terms in filler keep the reference DFS inside its budget
      // while still producing long in-order spans (the clamped-delta blind spot).
      const body = Array.from({ length: n }, () => (r() < 12 / n ? terms[int(r, 0, terms.length - 1)] : `f${int(r, 0, 50)}`)).join(" ");
      const span = minInOrderSpan(q, body);
      const want = oracleSpan(q, body);
      if (span !== want || !Object.is(proximityDelta(q, body), oracleDelta(q, body))) mismatches++;
      if (Number.isFinite(want) && want >= 40) wide++;
    }
    expect(mismatches).toBe(0);
    expect(wide).toBeGreaterThan(50); // the generator really exercises spans the delta clamps away
  });
});

describe("E2: BVA on window span", () => {
  const body = (gap: number) => ["aa", ...Array.from({ length: gap - 1 }, () => "xx"), "bb"].join(" ");
  it.each([
    [1, -1.95],
    [2, -1.9],
    [39, -0.05],
  ])("span %i → %f", (span, want) => {
    expect(proximityDelta(["aa", "bb"], body(span))).toBeCloseTo(want, 10);
  });
  it.each([40, 41])("span %i → exactly +0", (span) => {
    expect(Object.is(proximityDelta(["aa", "bb"], body(span)), 0)).toBe(true);
  });
});

describe("E3–E8: delta cases", () => {
  it("E3: the smallest chain wins (span 1, not 5)", () => {
    expect(proximityDelta(["aa", "bb"], "aa xx xx xx xx bb xx aa bb")).toBeCloseTo(-1.95, 10);
  });

  it("E4: duplicate query terms / equal positions match the oracle", () => {
    const cases: Array<[string[], string, number]> = [
      [["foo", "foo"], "foo", -2],
      [["foo", "foo", "bar"], "foo bar", -1.95],
      [["foo", "foo"], "bar baz", 0],
    ];
    for (const [q, b, want] of cases) {
      expect(proximityDelta(q, b)).toBeCloseTo(want, 10);
      expect(Object.is(proximityDelta(q, b), oracleDelta(q, b))).toBe(true);
    }
  });

  it("E5: a missing query term → exactly 0", () => {
    expect(Object.is(proximityDelta(["alpha", "beta", "gamma"], "alpha and beta only"), 0)).toBe(true);
  });

  it("E6: query order matters", () => {
    expect(Object.is(proximityDelta(["aa", "bb"], "bb aa"), 0)).toBe(true);
    expect(proximityDelta(["aa", "bb"], "bb aa bb")).toBeCloseTo(-1.95, 10);
  });

  it("E7: fewer than 2 query terms → 0", () => {
    for (const q of ["", "alpha", "the of"]) expect(Object.is(proximityDelta(tokenize(q), "alpha beta the of"), 0)).toBe(true);
  });

  it("E8: greedy early exits", () => {
    expect(Object.is(proximityDelta(["aa", "bb"], "bb bb aa"), 0)).toBe(true);
    // the later `aa`s have no `bb` after them; only `aa`@2 → `bb`@4 is viable (span 2)
    const b = "xx xx aa xx bb aa aa aa";
    expect(minInOrderSpan(["aa", "bb"], b)).toBe(2);
    expect(minInOrderSpan(["aa", "bb"], b)).toBe(oracleSpan(["aa", "bb"], b));
    expect(proximityDelta(["aa", "bb"], b)).toBe(oracleDelta(["aa", "bb"], b));
  });
});

describe("E7: <2-term query scores equal proximityBoost:false (store)", () => {
  let dir: string;
  let store: SqliteFtsStore;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-prox-e7-"));
    const docs = join(dir, "docs");
    mkdirSync(docs);
    for (let i = 0; i < 4; i++) writeFileSync(join(docs, `d${i}.md`), `# Doc ${i}\n\nalpha appears here ${"filler ".repeat(i * 3)} with the of words and alpha again.\n`);
    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir: docs });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(["alpha", "the of alpha"])("query %p", (q) => {
    expect(tokenize(q).length).toBeLessThan(2); // precondition: stopwords leave ≤1 term
    const on = store.search(q, { proximityBoost: true });
    const off = store.search(q, { proximityBoost: false });
    expect(on.map((h) => [h.path, h.score])).toEqual(off.map((h) => [h.path, h.score]));
    expect(on.length).toBeGreaterThan(0);
  });
});
