// Tests for change: fix-kb-search-lane-composition — the lead-slot rule that
// lets the reserved `agents` lane contest result slot 1 (design D1/D2/D3).
// Folded from openspec/changes/fix-kb-search-lane-composition/test-plan.md
// (E3 config BVA, E4 gate-off equivalence, E5 competitive lead, E6 non-competitive,
// E7 explicit doc_type, E8 laneQuota=0 coupling, E9 raw-score comparison,
// E10 lead bookkeeping, E11 endpoint semantics).
// Exemplar: packages/kb/src/__tests__/retrieval-quality.test.ts (store+fixture glue).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateConfig } from "../config.js";
import { indexSource } from "../indexer.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import type { KbHit, SearchOpts } from "../types.js";

// --------------------------------------------------------------------------
// E3 — config gate boundary values (BVA), mirroring the laneQuota validator.
// --------------------------------------------------------------------------
describe("E3: ranking.laneLeadMargin config validation", () => {
  const cfg = (laneLeadMargin: unknown) => () => validateConfig({ ranking: { laneLeadMargin } as never });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])("rejects out-of-range %p", (v) => {
    expect(cfg(v)).toThrow(/ranking\.laneLeadMargin must be a number in \[0,1\]/);
  });

  it.each(["x", null, {}])("rejects non-number %p", (v) => {
    expect(cfg(v)).toThrow(/ranking\.laneLeadMargin must be a number in \[0,1\]/);
  });

  it.each([0, 0.2, 1])("accepts in-range %p", (v) => {
    expect(cfg(v)().ranking.laneLeadMargin).toBe(v);
  });

  it("defaults to 0 (rule off) when unset", () => {
    expect(validateConfig({}).ranking.laneLeadMargin).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Shared corpus. Two queries with deliberately different lane gaps:
//   COMPETITIVE  — the AGENTS.md record scores close to the best doc chunk.
//   BURIED       — the AGENTS.md record trails far behind the best doc chunk.
// The gap is asserted as a PRECONDITION in each test, so a corpus drift makes
// the test fail loudly instead of passing vacuously on the wrong branch.
// --------------------------------------------------------------------------
describe("lead-slot rule over an indexed corpus", () => {
  let dir: string;
  let store: SqliteFtsStore;

  const pad = (s: string) => `${s} ${"neutral padding sentence to clear the tiny-chunk merge threshold. ".repeat(3)}`;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-lane-lead-"));
    // --- COMPETITIVE topic: the only doc source is verbose spec prose that
    // mentions the terms once amid padding, so BM25 length normalisation puts
    // it within a small relative gap of the (also long) agents record. This is
    // the real-world shape the change targets.
    writeFileSync(
      join(dir, "topic.md"),
      `# Telemetry Topic\n${"Prose paragraph about unrelated concerns, persistence, transport and configuration. ".repeat(30)}telemetry flush cadence explained for the reader. ${"More prose that carries none of the query terms whatsoever. ".repeat(30)}`,
    );
    // --- BURIED topic: many doc files repeat the terms; the agents record
    // mentions them once inside a long unrelated per-file table.
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(dir, `filler-${i}.md`), `# Filler ${i}\n${pad("scrollback windowing virtualisation scrollback windowing virtualisation")}`);
    }
    mkdirSync(join(dir, "src"), { recursive: true });
    // 18 unrelated rows is a tuned length: it dilutes the record just enough
    // that the doc lane still wins outright (gap > 0) while staying inside a
    // 0.2 margin. Fewer rows and the record wins the unrestricted lane by
    // itself, which would make E5's control assertion vacuous.
    const rows = Array.from({ length: 18 }, (_, i) => `| \`module-${i}.ts\` | unrelated per-file record ${i} covering indexing, persistence, transport and configuration concerns |`).join("\n");
    writeFileSync(
      join(dir, "src/AGENTS.md"),
      `# DOX\n| FILE | PURPOSE |\n|---|---|\n| \`telemetry.ts\` | telemetry flush cadence |\n| \`scroll.ts\` | scrollback windowing virtualisation |\n${rows}\n`,
    );
    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir }, { indexAgentsFiles: true, includeSourceMarkdown: false });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const COMPETITIVE = "telemetry flush cadence";
  const BURIED = "scrollback windowing virtualisation";
  const BASE: SearchOpts = { limit: 10, queryExpansion: "off", coverageRerank: false };

  /** Relative gap between the lanes' best RAW scores, as the rule computes it. */
  const gap = (q: string, opts: SearchOpts = BASE): number => {
    const best = (docType?: "agents") => store.search(q, { ...opts, docType, laneQuota: 0, laneLeadMargin: 0 })[0].score;
    const m0 = best();
    return (best("agents") - m0) / Math.abs(m0);
  };
  const paths = (h: KbHit[]) => h.map((x) => `${x.path}\u001f${x.headingPath}\u001f${x.score}`);

  // ------------------------------------------------------------------ E4
  it("E4: margin 0 leaves interleaving identical to the pre-change baseline", () => {
    for (const q of [COMPETITIVE, BURIED]) {
      const before = store.search(q, { ...BASE, laneQuota: 0.5 });
      const after = store.search(q, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0 });
      expect(paths(after)).toEqual(paths(before));
      expect(after.length).toBe(before.length);
    }
  });

  // ------------------------------------------------------------------ E5
  it("E5: a competitive agents candidate takes slot 1, exactly once under source dedup", () => {
    // Precondition: the record must genuinely LOSE the raw contest (gap > 0)
    // yet sit inside the margin — otherwise the test proves nothing.
    expect(gap(COMPETITIVE)).toBeGreaterThan(0);
    expect(gap(COMPETITIVE)).toBeLessThanOrEqual(0.2);
    const off = store.search(COMPETITIVE, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0 });
    expect(off[0].docType).not.toBe("agents"); // control: without the rule it does not lead

    const on = store.search(COMPETITIVE, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0.2 });
    expect(on[0].docType).toBe("agents");
    const led = `${on[0].root}\u001f${on[0].path}`;
    expect(on.filter((h) => `${h.root}\u001f${h.path}` === led).length).toBe(1);
  });

  // ------------------------------------------------------------------ E6
  it("E6: a non-competitive agents candidate leaves the page identical to margin 0", () => {
    expect(gap(BURIED)).toBeGreaterThan(0.2); // precondition: genuinely buried
    const off = store.search(BURIED, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0 });
    const on = store.search(BURIED, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0.2 });
    expect(on[0].docType).toBe("doc");
    expect(paths(on)).toEqual(paths(off));
  });

  // ------------------------------------------------------------------ E7
  it("E7: an explicit doc_type is never overridden by the lead rule", () => {
    for (const docType of ["doc", "agents"] as const) {
      const a = store.search(COMPETITIVE, { ...BASE, docType, laneLeadMargin: 0 });
      const b = store.search(COMPETITIVE, { ...BASE, docType, laneLeadMargin: 0.5 });
      expect(paths(b)).toEqual(paths(a));
      expect(b.every((h) => h.docType === docType)).toBe(true);
    }
  });

  // ------------------------------------------------------------------ E8
  it("E8: laneQuota 0 makes the knob inert — no reserved lane to lead with", () => {
    const a = store.search(COMPETITIVE, { ...BASE, laneQuota: 0, laneLeadMargin: 0 });
    const b = store.search(COMPETITIVE, { ...BASE, laneQuota: 0, laneLeadMargin: 0.5 });
    expect(paths(b)).toEqual(paths(a));
  });

  // ------------------------------------------------------------------ E10
  it("E10: after a lead pick, slot 2 comes from the main lane (running share 2/2 > 0.5)", () => {
    const on = store.search(COMPETITIVE, { ...BASE, laneQuota: 0.5, laneLeadMargin: 0.2 });
    expect(on[0].docType).toBe("agents");
    expect(on.length).toBeGreaterThan(1);
    expect(on[1].docType).not.toBe("agents");
    expect(new Set(on.map((h) => `${h.root}\u001f${h.path}`)).size).toBe(on.length);
  });

  // ------------------------------------------------------------------ E11
  it("E11: margin 1 leads unconditionally (documented degenerate endpoint)", () => {
    // All scores are strictly negative, so `r0 - m0 <= 1 * |m0|` reduces to
    // `r0 <= 0` — always true. Asserted on the BURIED query, where the reserved
    // lane loses under every non-degenerate margin.
    const all = store.search(BURIED, { ...BASE, limit: 50, sourceDedup: false, laneQuota: 0, laneLeadMargin: 0 });
    expect(all.every((h) => h.score < 0)).toBe(true); // precondition: endpoint semantics hold
    const on = store.search(BURIED, { ...BASE, laneQuota: 0.5, laneLeadMargin: 1 });
    expect(on[0].docType).toBe("agents");
  });
});

// --------------------------------------------------------------------------
// E9 — the decision reads RAW BM25(+proximity) scores, captured before the
// coverage rerank re-sorts the lane. MMR reorders only and cannot corrupt it;
// `coverageRerank` fully re-sorts, so the re-sorted head differs from the raw
// best and using it would flip the slot-1 decision.
// --------------------------------------------------------------------------
describe("E9: slot-1 decision uses raw scores, not the coverage-reranked head", () => {
  let dir: string;
  let store: SqliteFtsStore;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "kb-lane-lead-cov-"));
    const pad = "filler words that carry none of the query terms at all whatsoever. ".repeat(3);
    // `narrow` wins on raw BM25 by term repetition; `broad` wins on coverage.
    // The coverage rerank therefore MOVES the main lane's head, which is the
    // whole point of this fixture.
    for (let i = 0; i < 25; i++) writeFileSync(join(dir, `common-${i}.md`), `# Common ${i}\nbeta gamma delta appear here in document ${i}. ${pad}`);
    writeFileSync(join(dir, "broad.md"), `# Broad\nalpha beta gamma delta appear once each here. ${pad}`);
    writeFileSync(join(dir, "narrow.md"), `# Narrow\n${"alpha ".repeat(80)}repeated. ${pad}`);
    mkdirSync(join(dir, "src"), { recursive: true });
    // 10 unrelated rows dilute the record to a score that sits BETWEEN the raw
    // main head (`narrow`, strongly negative) and the coverage-reranked head
    // (`broad`, weakly negative). That is what makes the raw and re-sorted
    // comparisons DISAGREE at margin 0.2 — without it both say "lead" and the
    // test passes under either implementation.
    const rows = Array.from({ length: 10 }, (_, i) => `| \`m-${i}.ts\` | unrelated per-file record ${i} covering indexing persistence transport configuration |`).join("\n");
    writeFileSync(join(dir, "src/AGENTS.md"), `# DOX\n| FILE | PURPOSE |\n|---|---|\n| \`alpha.ts\` | alpha beta gamma delta per-file record |\n${rows}\n`);
    store = new SqliteFtsStore(join(dir, ".kb.db"));
    store.init();
    await indexSource(store, { root: "t", dir }, { indexAgentsFiles: true, includeSourceMarkdown: false });
  });
  afterAll(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const Q = "alpha beta gamma delta";
  const COV: SearchOpts = { limit: 5, queryExpansion: "off", coverageRerank: true, diversity: { enabled: true, lambda: 0.7 } };

  it("the coverage rerank moves the main lane's head (fixture precondition)", () => {
    const raw = store.search(Q, { ...COV, coverageRerank: false, diversity: { enabled: false, lambda: 0.7 }, docType: "doc" })[0];
    const reranked = store.search(Q, { ...COV, docType: "doc" })[0];
    expect(reranked.path).not.toBe(raw.path);
  });

  it("slot 1 matches the RAW best-score comparison, not the re-sorted head", () => {
    const margin = 0.2;
    const leads = (r: number, m: number) => r - m <= margin * Math.abs(m);
    const best = (docType: "doc" | "agents" | undefined, coverageRerank: boolean) =>
      store.search(Q, { limit: 5, queryExpansion: "off", coverageRerank, docType, laneQuota: 0, laneLeadMargin: 0 })[0].score;
    const rawSaysLead = leads(best("agents", false), best(undefined, false));
    // Precondition: the two comparisons must DISAGREE, else the assertion below
    // holds under either implementation and proves nothing.
    expect(leads(best("agents", true), best("doc", true))).not.toBe(rawSaysLead);

    const hits = store.search(Q, { ...COV, laneQuota: 0.5, laneLeadMargin: margin });
    expect(hits[0].docType === "agents").toBe(rawSaysLead);
  });
});
