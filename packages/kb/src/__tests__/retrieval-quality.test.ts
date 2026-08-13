// Tests for change: fix-kb-search-retrieval-quality.
// Redundancy metrics (D8), source-level dedup (D1/D2/D6), condensed render (D5),
// doc-type lane quota (D3), PRF + coverage rerank (D4), kb_get truncation (D7).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "../eval.js";
import { indexSource } from "../indexer.js";
import { renderHits } from "../render.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import type { KbHit, KbStore } from "../types.js";

/** Minimal KbStore stub: `search()` replays a canned hit list. */
function stubStore(pages: Record<string, Array<Partial<KbHit>>>): KbStore {
  return {
    search: (q: string) =>
      (pages[q] ?? []).map((h, i) => ({
        root: h.root ?? "r",
        path: h.path ?? `p${i}.md`,
        headingPath: h.headingPath ?? "H",
        chunkId: h.chunkId ?? `c${i}`,
        docType: h.docType ?? "doc",
        score: h.score ?? -1,
        snippet: h.snippet ?? "s",
      })),
  } as unknown as KbStore;
}

describe("eval: result-redundancy metrics (D8)", () => {
  it("an all-distinct page has duplicate-slot share 0 and is not single-source", () => {
    const store = stubStore({ q: [{ path: "a.md" }, { path: "b.md" }, { path: "c.md" }, { path: "d.md" }] });
    const m = evaluate(store, [{ q: "q", expect: "a.md" }], { k: 4 });
    expect(m.duplicateSlotShare).toBe(0);
    expect(m.distinctSourcesAtK).toBe(4);
    expect(m.singleSourcePageRate).toBe(0);
  });

  it("an all-one-source page has duplicate-slot share (K-1)/K and single-source rate 1", () => {
    const K = 4;
    const store = stubStore({ q: Array.from({ length: K }, (_, i) => ({ path: "a.md", headingPath: `S${i}` })) });
    const m = evaluate(store, [{ q: "q", expect: "a.md" }], { k: K });
    expect(m.duplicateSlotShare).toBeCloseTo((K - 1) / K, 3);
    expect(m.distinctSourcesAtK).toBe(1);
    expect(m.singleSourcePageRate).toBe(1);
  });

  it("distinct sources are keyed by (root, path), not path alone", () => {
    const store = stubStore({ q: [{ root: "r1", path: "a.md" }, { root: "r2", path: "a.md" }] });
    const m = evaluate(store, [{ q: "q", expect: "a.md" }], { k: 2 });
    expect(m.distinctSourcesAtK).toBe(2);
    expect(m.duplicateSlotShare).toBe(0);
  });

  it("reports redundancy metrics alongside the ranking metrics", () => {
    const store = stubStore({ q: [{ path: "a.md" }] });
    const m = evaluate(store, [{ q: "q", expect: "a.md" }], { k: 10 });
    for (const key of ["P@1", "P@5", "Recall@K", "MRR", "nDCG@K", "distinctSourcesAtK", "duplicateSlotShare", "singleSourcePageRate"]) {
      expect(m).toHaveProperty(key);
    }
    expect(m["P@1"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("store: source-level dedup, lane quota, coverage rerank, PRF, getChunk", () => {
  let dir: string;
  let store: SqliteFtsStore;

  // Bodies must be DISTINCT: exact-content dedup collapses byte-identical bodies
  // first, which would hide the section-level redundancy under test.
  let uniq = 0;
  const long = (s: string) => `${s} ${`padding number ${uniq++} to clear the tiny-chunk merge threshold in the chunker. `.repeat(3)}`;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-rq-"));
    // A spec-like file with many sections all matching one topic → the redundancy shape.
    const spec = ["# Chat View Spec", long("The chat view collapses and expands messages.")]
      .concat(Array.from({ length: 8 }, (_, i) => `## Scenario ${i}\n${long("collapsed messages chat view collapse expand behaviour")}`))
      .join("\n");
    writeFileSync(join(dir, "spec.md"), spec);
    const other = `# Other\n${long("collapsed messages chat view collapse expand in another document")}`;
    writeFileSync(join(dir, "other.md"), other);
    // Enough competing `doc` sources that the rare+long `agents` chunk is buried
    // past rank 10 by BM25 alone — the ~30:1 burial the lane quota exists to fix.
    for (let i = 0; i < 30; i++) {
      writeFileSync(join(dir, `filler-${i}.md`), `# Filler ${i}\n${long("collapsed messages chat view collapse expand filler prose")}`);
    }
    // An AGENTS.md record — the rare `agents` doc-type lane. Deliberately dilute:
    // long, and only partly on-topic, exactly like a real per-file record table.
    mkdirSync(join(dir, "src"), { recursive: true });
    const rows = Array.from(
      { length: 40 },
      (_, i) => `| \`module-${i}.ts\` | unrelated per-file record ${i} covering indexing, persistence, transport, configuration and telemetry concerns |`,
    ).join("\n");
    writeFileSync(
      join(dir, "src/AGENTS.md"),
      `# DOX\n| FILE | PURPOSE |\n|---|---|\n| \`chat-view.ts\` | collapsed messages chat view collapse expand per-file record |\n${rows}\n`,
    );
    // A vendored BYTE-IDENTICAL copy → exact-content dedup must still fire first.
    mkdirSync(join(dir, "vendor"), { recursive: true });
    writeFileSync(join(dir, "vendor/other.md"), other);

    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const Q = "collapsed messages chat view collapse expand";

  it("returns exactly one hit per (root, path) by default", () => {
    const hits = store.search(Q, { limit: 10 });
    const keys = hits.map((h) => `${h.root}\u001f${h.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(hits.some((h) => h.path.endsWith("spec.md"))).toBe(true);
  });

  it("the representative is the best-scoring chunk of its source", () => {
    const all = store.search(Q, { limit: 50, sourceDedup: false });
    const specChunks = all.filter((h) => h.path.endsWith("spec.md"));
    expect(specChunks.length).toBeGreaterThan(1);
    const best = Math.min(...specChunks.map((h) => h.score));
    const rep = store.search(Q, { limit: 10 }).find((h) => h.path.endsWith("spec.md"))!;
    expect(rep.score).toBeCloseTo(best, 6);
  });

  it("reports the suppressed-section count, and zero when a source matched once", () => {
    const hits = store.search(Q, { limit: 10 });
    const spec = hits.find((h) => h.path.endsWith("spec.md"))!;
    expect(spec.suppressedSections).toBeGreaterThan(0);
    const agents = hits.find((h) => h.path.endsWith("AGENTS.md"))!;
    expect(agents.suppressedSections).toBe(0);
  });

  it("runs source dedup AFTER exact-content dedup, so akaPaths still populate", () => {
    const hits = store.search(Q, { limit: 10 });
    const other = hits.find((h) => h.path.endsWith("other.md"))!;
    expect(other.akaPaths?.length).toBeGreaterThanOrEqual(1);
  });

  it("source dedup can be disabled", () => {
    const hits = store.search(Q, { limit: 20, sourceDedup: false });
    const specCount = hits.filter((h) => h.path.endsWith("spec.md")).length;
    expect(specCount).toBeGreaterThan(1);
  });

  it("limit bounds distinct sources", () => {
    const hits = store.search(Q, { limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(new Set(hits.map((h) => h.path)).size).toBe(hits.length);
  });

  it("the candidate pool is a multiple of limit, not limit itself", () => {
    // With limit 2 and 4 sources indexed, a pool of exactly 2 chunks would only
    // ever see spec.md's sections; a deeper pool surfaces a second source.
    const hits = store.search(Q, { limit: 2 });
    expect(new Set(hits.map((h) => h.path)).size).toBe(2);
  });

  it("completes a default search within the 50 ms budget", () => {
    store.search(Q, { limit: 10 }); // warm the prepared statement
    const t = performance.now();
    store.search(Q, { limit: 10 });
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("surfaces agents hits without a docType filter (lane quota)", () => {
    const hits = store.search(Q, { limit: 10 });
    expect(hits.some((h) => h.docType === "agents")).toBe(true);
  });

  it("an explicit docType filter bypasses the quota", () => {
    const hits = store.search(Q, { limit: 10, docType: "doc" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.docType === "doc")).toBe(true);
  });

  it("a lane share of zero disables the quota (paired with the quota on)", () => {
    // Isolate the quota from the other stages: pure BM25 burial is the defect
    // D3 corrects, so hold expansion and coverage rerank fixed across the pair.
    const base = { limit: 10, queryExpansion: "off", coverageRerank: false } as const;
    const off = store.search(Q, { ...base, laneQuota: 0 });
    expect(off.length).toBe(10);
    expect(off.some((h) => h.docType === "agents")).toBe(false);
    const on = store.search(Q, { ...base, laneQuota: 0.4 });
    expect(on.some((h) => h.docType === "agents")).toBe(true);
  });

  it("a starved lane yields its slots to the other lane", () => {
    // `queryExpansion: off` keeps PRF from pulling extra terms in: the point here
    // is the interleave, not the expansion.
    const hits = store.search("filler prose", { limit: 5, queryExpansion: "off" });
    // Only ONE agents chunk exists, so its lane can never fill its 40% share —
    // the doc lane must yield-fill the page to `limit`.
    expect(hits.length).toBe(5);
    expect(hits.filter((h) => h.docType === "agents").length).toBeLessThanOrEqual(1);
    expect(new Set(hits.map((h) => h.path)).size).toBe(5);
  });

  // --- D4: coverage rerank + PRF. Implemented, DEFAULT OFF (measured a net
  // regression on the bundled fixtures) — so these exercise the opt-in path.

  it("coverage rerank puts broader query coverage above concentrated repetition", () => {
    const d = mkdtempSync(join(tmpdir(), "kb-cov-"));
    const s = new SqliteFtsStore(join(d, ".kb.db"));
    s.init();
    const pad = "filler words that carry none of the query terms at all whatsoever. ".repeat(3);
    // `narrow` wins on BM25 by sheer term frequency; `broad` wins on coverage by
    // touching every query term once. The two rankers must disagree, otherwise
    // the assertion proves nothing about the rerank.
    // beta/gamma/delta are made COMMON so BM25 discounts them, leaving the rare
    // `alpha` to dominate raw scoring; coverage still values all four.
    for (let i = 0; i < 25; i++) writeFileSync(join(d, `common-${i}.md`), `# Common ${i}\nbeta gamma delta appear here in document ${i}. ${pad}`);
    writeFileSync(join(d, "broad.md"), `# Broad\nalpha beta gamma delta appear once each here. ${pad}`);
    writeFileSync(join(d, "narrow.md"), `# Narrow\n${"alpha ".repeat(80)}repeated. ${pad}`);
    return indexSource(s, { root: "t", dir: d }).then(() => {
      const off = s.search("alpha beta gamma delta", { limit: 5, coverageRerank: false, queryExpansion: "off" });
      expect(off[0].path).toMatch(/narrow\.md$/); // control: BM25 prefers repetition
      const on = s.search("alpha beta gamma delta", { limit: 5, coverageRerank: true, queryExpansion: "off" });
      expect(on[0].path).toMatch(/broad\.md$/); // rerank flips it to coverage
      s.close();
      rmSync(d, { recursive: true, force: true });
    });
  });

  it("PRF is skipped when coverage rerank is disabled", () => {
    // Same query, PRF requested but coverage off → identical to no expansion.
    const withPrf = store.search(Q, { limit: 10, queryExpansion: "prf", coverageRerank: false });
    const noPrf = store.search(Q, { limit: 10, queryExpansion: "off", coverageRerank: false });
    expect(withPrf.map((h) => h.path)).toEqual(noPrf.map((h) => h.path));
  });

  it("PRF mines bounded feedback terms that exclude the query's own terms", () => {
    const terms = (store as unknown as { prfTerms: (q: string, qt: string[], rows: unknown[], o: object) => string[] }).prfTerms.bind(store);
    const rows = Array.from({ length: 12 }, () => ({ headingPath: "H", body: "scrollback virtualisation windowing scrollback virtualisation" }));
    const mined = terms(Q, Q.split(" "), rows, { prf: { terms: 3 } });
    expect(mined.length).toBeLessThanOrEqual(3);
    for (const t of mined) expect(Q.split(" ")).not.toContain(t);
  });

  it("PRF mines nothing from a feedback set too small to be a feedback set", () => {
    const terms = (store as unknown as { prfTerms: (q: string, qt: string[], rows: unknown[], o: object) => string[] }).prfTerms.bind(store);
    expect(terms(Q, Q.split(" "), [{ headingPath: "H", body: "one lonely candidate document" }], {})).toEqual([]);
  });

  it("expansion cannot dominate the sort: original terms outweigh appended ones", () => {
    const d = mkdtempSync(join(tmpdir(), "kb-prf-"));
    const s = new SqliteFtsStore(join(d, ".kb.db"));
    s.init();
    const pad = "neutral filler sentence carrying no query terms at all. ".repeat(3);
    writeFileSync(join(d, "original.md"), `# Original\nzetaterm etaterm thetaterm all present together once. ${pad}`);
    writeFileSync(join(d, "expanded.md"), `# Expanded\n${"appendedterm ".repeat(40)}only. ${pad}`);
    return indexSource(s, { root: "t", dir: d }).then(() => {
      const candidates = s.search("zetaterm etaterm thetaterm appendedterm", { limit: 10, queryExpansion: "off", coverageRerank: false });
      // Coverage needs the real bodies, else every candidate scores 0 and the
      // assertion would be vacuous.
      const bodies = new Map(candidates.map((h) => [h.chunkId, s.getChunkById(h.root, h.chunkId)!.body]));
      const rerank = (s as unknown as { coverageRerank: (h: KbHit[], b: Map<string, string>, q: string[], e: string[]) => KbHit[] }).coverageRerank.bind(s);
      // Original terms at full weight, the appended term at half → original wins.
      expect(rerank(candidates, bodies, ["zetaterm", "etaterm", "thetaterm"], ["appendedterm"])[0].path).toMatch(/original\.md$/);
      // Sanity: if the appended term were treated as an ORIGINAL term, the
      // stuffed doc would be competitive again — proving the weighting is live.
      expect(rerank(candidates, bodies, ["appendedterm"], [])[0].path).toMatch(/expanded\.md$/);
      s.close();
      rmSync(d, { recursive: true, force: true });
    });
  });

  it("path-only getChunk reports how many further sections exist", () => {
    const c = store.getChunk("t", "spec.md");
    expect(c).toBeTruthy();
    expect(c!.suppressedSections).toBeGreaterThan(0);
    const single = store.getChunk("t", "src/AGENTS.md");
    expect(single!.suppressedSections).toBe(0);
  });

  it("getChunk by heading path is unchanged and reports no suppressed sections", () => {
    const all = store.search(Q, { limit: 50, sourceDedup: false });
    const one = all.find((h) => h.path.endsWith("spec.md"))!;
    const c = store.getChunk("t", "spec.md", one.headingPath)!;
    expect(c.headingPath).toBe(one.headingPath);
    expect(c.suppressedSections ?? 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("render: condensed leaf-heading form (D5)", () => {
  const hit = (over: Partial<KbHit> = {}): KbHit => ({
    root: "r",
    path: "specs/chat-view/spec.md",
    headingPath: "Chat View > Requirement: Collapse > Scenario: Expand a collapsed message",
    chunkId: "c1",
    docType: "doc",
    score: -3.5,
    snippet: "some snippet text",
    ...over,
  });

  const opts = { leading: "rank", parentGlyph: "⤷ ", multiline: true } as const;

  it("renders the leaf heading, not the full breadcrumb", () => {
    const out = renderHits([hit()], opts);
    expect(out).toContain("Scenario: Expand a collapsed message");
    expect(out).not.toContain("Chat View > Requirement: Collapse");
  });

  it("shows the suppressed-section marker when the count is > 0", () => {
    const out = renderHits([hit({ suppressedSections: 7 })], opts);
    expect(out).toMatch(/\(\+7 more sections?\)/);
  });

  it("omits the suppressed-section marker when the count is 0", () => {
    const out = renderHits([hit({ suppressedSections: 0 })], opts);
    expect(out).not.toMatch(/more sections?/);
  });

  it("still shows the akaPaths duplicate marker", () => {
    const out = renderHits([hit({ akaPaths: ["vendor/spec.md"] })], opts);
    expect(out).toContain("(+1 dup)");
  });

  it("applies the leaf-heading form to the single-line CLI shape too", () => {
    const out = renderHits([hit({ suppressedSections: 3 })], { leading: "score", parentGlyph: "[parent: ", multiline: false });
    expect(out).toContain("Scenario: Expand a collapsed message");
    expect(out).not.toContain("Chat View > Requirement: Collapse");
    expect(out).toMatch(/\(\+3 more sections?\)/);
  });
});
