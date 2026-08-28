// Tests for the shared search-options helper (search-opts.ts).
// Folded from openspec/changes/fix-kb-eval-measurement-integrity/test-plan.md
// (E1 behavioural parity, E2 decision table, E3 structural key-coverage).
// Exemplar: packages/kb-extension/src/__tests__/kb-search-tool.test.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type ResolvedConfig } from "../config.js";
import { searchOptsFromConfig } from "../search-opts.js";
import type { SearchOpts } from "../types.js";

let dir: string;
let cfg: ResolvedConfig;
const SOURCES = [{ id: "docs", dir: join(tmpdir(), "search-opts-nonexistent"), priority: 5 }];

beforeAll(() => {
  // Empty temp dir → no project/global config in the test HOME → pure DEFAULTS.
  dir = mkdtempSync(join(tmpdir(), "kb-search-opts-"));
  cfg = loadConfig(dir);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("searchOptsFromConfig (E1 behavioural parity)", () => {
  it("default config + sources: helper + extension overrides deep-equals the object extension.ts passes today, field-by-field", () => {
    const out = searchOptsFromConfig(cfg, {
      sources: SOURCES,
      overrides: { expandGraph: false, rerank: false },
    });
    // The exact inline object `packages/kb-extension/src/extension.ts` kb_search
    // passes today, frozen here so any drift at either site fails this test.
    // limit/docType come from tool params; the full object is assembled here
    // exactly as the extension assembles it ({limit, docType, ...ranking}).
    const out_full: SearchOpts = { limit: 10, docType: undefined, ...out };
    const TODAY: SearchOpts = {
      limit: 10,
      docType: undefined,
      fieldWeights: cfg.ranking.fieldWeights,
      proximityBoost: cfg.ranking.proximityBoost,
      diversity: cfg.ranking.diversity,
      sourceDedup: cfg.ranking.sourceDedup,
      laneQuota: cfg.ranking.laneQuota,
      coverageRerank: cfg.ranking.coverageRerank,
      queryExpansion: cfg.queryExpansion.mode,
      prf: cfg.queryExpansion.prf,
      expandParent: cfg.expand.parent,
      rootPriority: Object.fromEntries(SOURCES.map((s) => [s.id, s.priority])),
    };
    // Field-by-field over all 12 keys + limit/docType.
    for (const k of Object.keys(TODAY) as Array<keyof SearchOpts>) {
      expect(out_full[k], `field ${k}`).toEqual(TODAY[k]);
    }
    // The two CLI-only fields are the extension's behaviour "now written down"
    // (design D2): absent today → falsy; helper pins them explicitly false.
    expect(out.expandGraph).toBe(false);
    expect(out.rerank).toBe(false);
    expect(out.prf).toEqual(cfg.queryExpansion.prf);
  });
});

describe("searchOptsFromConfig (E2 decision table)", () => {
  // One config per flag case: the targeted cfg field sits OPPOSITE the flag's
  // effect, so the override must flip exactly that field and nothing else.
  const flipped = (field: string, value: unknown): ResolvedConfig => {
    const c = structuredClone(cfg) as ResolvedConfig;
    if (field === "ranking.sourceDedup") c.ranking.sourceDedup = value as boolean;
    else if (field === "ranking.laneQuota") c.ranking.laneQuota = value as number;
    else if (field === "ranking.coverageRerank") c.ranking.coverageRerank = value as boolean;
    else if (field === "expand.parent") c.expand.parent = value as boolean;
    else if (field === "expand.graph") c.expand.graph = value as boolean;
    else if (field === "rerank.enabled") c.rerank.enabled = value as boolean;
    else if (field === "queryExpansion.mode") c.queryExpansion.mode = value as "off";
    return c;
  };

  const CASES: Array<{
    flag: string;
    overrides: Record<string, unknown>;
    field: string;
    cfgField: string;
    cfgValue: unknown;
    expected: unknown;
  }> = [
    { flag: "--no-source-dedup", overrides: { sourceDedup: false }, field: "sourceDedup", cfgField: "ranking.sourceDedup", cfgValue: true, expected: false },
    { flag: "--no-lane-quota", overrides: { laneQuota: 0 }, field: "laneQuota", cfgField: "ranking.laneQuota", cfgValue: 0.5, expected: 0 },
    { flag: "--no-coverage-rerank", overrides: { coverageRerank: false }, field: "coverageRerank", cfgField: "ranking.coverageRerank", cfgValue: true, expected: false },
    { flag: "--no-expand-parent", overrides: { expandParent: false }, field: "expandParent", cfgField: "expand.parent", cfgValue: true, expected: false },
    { flag: "--expand-parent", overrides: { expandParent: true }, field: "expandParent", cfgField: "expand.parent", cfgValue: false, expected: true },
    { flag: "--expand-graph", overrides: { expandGraph: true }, field: "expandGraph", cfgField: "expand.graph", cfgValue: false, expected: true },
    { flag: "--rerank", overrides: { rerank: true }, field: "rerank", cfgField: "rerank.enabled", cfgValue: false, expected: true },
    { flag: "--expand-query", overrides: { queryExpansion: "synonym" }, field: "queryExpansion", cfgField: "queryExpansion.mode", cfgValue: "off", expected: "synonym" },
  ];

  for (const c of CASES) {
    it(`${c.flag} flips exactly its field; the other 11 stay at config values`, () => {
      const cfg2 = flipped(c.cfgField, c.cfgValue); // ONE clone, shared by both calls
      const base = searchOptsFromConfig(cfg2, { sources: SOURCES });
      const out = searchOptsFromConfig(cfg2, { sources: SOURCES, overrides: c.overrides });
      const neq = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b); // structural: rootPriority/prf/fieldWeights are fresh objects per call
      const changed = (Object.keys(base) as Array<keyof SearchOpts>).filter((k) => neq(base[k], out[k]));
      expect(changed, "exactly one field changes").toEqual([c.field]);
      expect(out[c.field as keyof SearchOpts]).toBe(c.expected);
    });
  }

  it("eval path (extension overrides) ignores CLI-only flags: expandGraph/rerank forced false even on a config that enables them", () => {
    const c = flipped("expand.graph", true);
    c.rerank.enabled = true;
    const out = searchOptsFromConfig(c, { sources: SOURCES, overrides: { expandGraph: false, rerank: false } });
    expect(out.expandGraph).toBe(false);
    expect(out.rerank).toBe(false);
  });
});

describe("searchOptsFromConfig (E3 structural key-coverage)", () => {
  it("Object.keys(helper(cfg, src)) covers the canonical 12-key ranking list", () => {
    const out = searchOptsFromConfig(cfg, { sources: SOURCES });
    const CANONICAL = [
      "fieldWeights",
      "proximityBoost",
      "diversity",
      "sourceDedup",
      "laneQuota",
      "coverageRerank",
      "queryExpansion",
      "prf",
      "expandParent",
      "expandGraph",
      "rerank",
      "rootPriority",
    ];
    const keys = new Set(Object.keys(out));
    for (const k of CANONICAL) expect(keys.has(k), `missing ranking key: ${k}`).toBe(true);
  });
});
