/**
 * E56 — the business-2031 fixture is the corpus's showroom: EVERY card is
 * presented on exactly one slide, and no card is presented twice.
 *
 * This is a forcing function, not decoration. A new card added to `src/fx/`
 * fails here until it is placed on a slide, which is the only mechanism that
 * keeps "the fixture demonstrates the corpus" true as the corpus grows.
 *
 * Read from the BUILT IR, not from `overrides.json`: deck-scope effects
 * prepend to every slide, so a card parked at deck scope would read as
 * covered in the source file while actually being duplicated 40 times on
 * screen. The merged per-slide lists are the only honest witness.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../ir/merge.js";
import type { DeckIR } from "../../ir/types.js";

const FIXTURE = new URL("../../../fixtures/business-2031/", import.meta.url).pathname;
const FX_DIR = new URL("../", import.meta.url).pathname;

const ir = JSON.parse(readFileSync(`${FIXTURE}deck.json`, "utf8")) as DeckIR;
const merged = applyOverrides(ir);

const corpus = readdirSync(FX_DIR)
  .filter((f) => f.endsWith(".meta.json"))
  .map((f) => (JSON.parse(readFileSync(`${FX_DIR}${f}`, "utf8")) as { id: string }).id)
  .sort();

/** id → slide ids presenting it. */
const placements = new Map<string, string[]>();
for (const slide of merged.slides) {
  for (const ref of slide.effects ?? []) {
    placements.set(ref.id, [...(placements.get(ref.id) ?? []), slide.id]);
  }
}

describe("E56 business-2031 presents the whole corpus, once each", () => {
  it("covers every corpus card", () => {
    const missing = corpus.filter((id) => !placements.has(id));
    expect(missing, `add these to fixtures/business-2031/build-overrides.mjs PLAN: ${missing.join(", ")}`).toEqual([]);
  });

  it("presents no card on two slides", () => {
    const duplicated = [...placements.entries()]
      .filter(([, slides]) => slides.length > 1)
      .map(([id, slides]) => `${id} on ${slides.join(" + ")}`);
    expect(duplicated).toEqual([]);
  });

  it("parks nothing at deck scope, where it would repeat on every slide", () => {
    expect(ir.overrides?.effects ?? []).toEqual([]);
  });

  it("still exercises the local-effect pipeline with exactly one pinned module", () => {
    const local = [...placements.keys()].filter((id) => id.startsWith("local:"));
    expect(local).toEqual(["local:closing-mark"]);
    const ref = merged.slides.flatMap((s) => s.effects ?? []).find((e) => e.id === "local:closing-mark");
    expect(ref?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
