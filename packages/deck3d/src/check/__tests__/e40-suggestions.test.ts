/**
 * E40 (test-plan) — check: every finding's suggestion is an `overrides` key that
 * resolves in the IR schema.
 *
 * Property: for every rule kind (fit/legibility/overlap/occlusion/contrast/
 * skipped) and a sample measurement that triggers it, the emitted `suggest`
 * matches `/^overrides\./` and names an existing path in `ir/schema.json` — so
 * the CLI hint is always a key a human/LLM can actually write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastFindings,
  fitFindings,
  type Finding,
  legibilityFindings,
  type Measurement,
  occlusionFindings,
  overlapFindings,
  type RuleName,
  type SlideRef,
  skippedFindings,
} from "../rules.js";

const SLIDE: SlideRef = { id: "arch", index: 2 };
const SCHEMA = JSON.parse(readFileSync(new URL("../../ir/schema.json", import.meta.url), "utf8")) as {
  definitions: { overrides: { properties: Record<string, { additionalProperties?: { properties?: Record<string, unknown> } }> } };
};

type SchemaNode = { properties?: Record<string, SchemaNode> };

/** Resolve `overrides.slides["id"].a.b` / `overrides.nodes["id"].a` against the schema. */
function resolves(path: string): boolean {
  const match = /^overrides\.(slides|nodes)\["[^"]+"\]\.(.+)$/.exec(path);
  if (!match) return false;
  const root = SCHEMA.definitions.overrides.properties[match[1]]?.additionalProperties?.properties as Record<string, SchemaNode> | undefined;
  if (!root) return false;
  let node: SchemaNode = { properties: root };
  for (const segment of match[2].split(".")) {
    const next = node.properties?.[segment];
    if (!next) return false;
    node = next;
  }
  return true;
}

function label(id: string, rect: { x: number; y: number; w: number; h: number }, capHeight: number, extra: Partial<Measurement> & { bgLuminance?: number } = {}): Measurement & { bgLuminance?: number } {
  return { kind: "label", id, text: id, rect, capHeight, ...extra };
}

/** One triggering measurement per rule kind. */
const samples: Array<{ rule: RuleName; finding: Finding }> = [
  {
    rule: "fit",
    finding: fitFindings([label("A", { x: 0, y: 0, w: 2000, h: 10 }, 20)], { w: 1920, h: 1080 }, SLIDE)[0],
  },
  { rule: "legibility", finding: legibilityFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 1)], 1080, SLIDE)[0] },
  {
    rule: "overlap",
    finding: overlapFindings(
      [label("A", { x: 0, y: 0, w: 1, h: 1 }, 20), label("B", { x: 0.5, y: 0, w: 1, h: 1 }, 20)],
      SLIDE,
    )[0],
  },
  { rule: "occlusion", finding: occlusionFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { hit: "B" })], SLIDE)[0] },
  {
    rule: "contrast",
    finding: contrastFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { color: "#888888", bgLuminance: 0.5 })], SLIDE)[0],
  },
  { rule: "skipped", finding: skippedFindings(["glyph-rain: dark only"], SLIDE)[0] },
];

describe("check suggestions are overrides keys (E40)", () => {
  it("samples cover every finding kind", () => {
    expect(samples.every((s) => s.finding != null)).toBe(true);
    expect(new Set(samples.map((s) => s.finding.rule))).toEqual(
      new Set<RuleName>(["fit", "legibility", "overlap", "occlusion", "contrast", "skipped"]),
    );
  });

  it("every suggestion matches /^overrides\\./ and resolves in schema.json", () => {
    for (const { rule, finding } of samples) {
      expect(finding.rule).toBe(rule);
      expect(finding.suggest, `${rule} suggestion`).toMatch(/^overrides\./);
      expect(resolves(finding.suggest), `${rule}: ${finding.suggest}`).toBe(true);
    }
  });

  it("resolves across a matrix of triggering measurements (property sweep)", () => {
    const fits = fitFindings(
      [label("A", { x: 1, y: 1, w: 5000, h: 5000 }, 20)],
      { w: 1920, h: 1080 },
      SLIDE,
    );
    const legibilities = [1, 5, 13.99].flatMap((cap) => legibilityFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, cap)], 1080, SLIDE));
    const occlusions = occlusionFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { hit: "N" })], SLIDE);
    const all = [...fits, ...legibilities, ...occlusions];
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const f of all) {
      expect(f.suggest).toMatch(/^overrides\./);
      expect(resolves(f.suggest), `${f.rule}: ${f.suggest}`).toBe(true);
    }
  });
});
