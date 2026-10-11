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
import { PERSISTENT_FX } from "../persistent.js";
import { STUB_PARAMS } from "../stub-assets.js";

const FIXTURE = new URL("../../../fixtures/business-2031/", import.meta.url).pathname;
const FX_DIR = new URL("../", import.meta.url).pathname;

const ir = JSON.parse(readFileSync(`${FIXTURE}deck.json`, "utf8")) as DeckIR;
const merged = applyOverrides(ir);

interface Card {
  id: string;
  kind: string;
  cost: number;
  modes: string;
  persistent?: boolean;
  replacesContent?: boolean;
  source: string;
  licence: string;
  conflicts: string[];
  tags: { topic?: string[] };
}
const cards: Card[] = readdirSync(FX_DIR)
  .filter((f) => f.endsWith(".meta.json"))
  .map((f) => JSON.parse(readFileSync(`${FX_DIR}${f}`, "utf8")) as Card);
const persistentIds = cards.filter((c) => c.persistent).map((c) => c.id).sort();
/** Persistent cards sit once at deck scope, so they are not slide placements. */
const corpus = cards.filter((c) => !c.persistent).map((c) => c.id).sort();

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

  it("parks nothing but persistent cards at deck scope, each exactly once (E35)", () => {
    const deckScope = (ir.overrides?.effects ?? []).map((e) => e.id).sort();
    expect(deckScope).toEqual(persistentIds);
    for (const id of persistentIds) expect(placements.has(id), `${id} must not be prepended to any slide`).toBe(false);
  });

  it("fails when a non-persistent card is parked at deck scope (E35)", () => {
    const bad = { ...ir, overrides: { ...ir.overrides, effects: [...(ir.overrides.effects ?? []), { id: "fog" }] } } as DeckIR;
    const nonPersistent = (bad.overrides.effects ?? []).filter((e) => !persistentIds.includes(e.id)).map((e) => e.id);
    expect(nonPersistent).toEqual(["fog"]);
  });

  it("keeps the static persistent registry in step with the cards", () => {
    expect([...PERSISTENT_FX].sort()).toEqual(persistentIds);
  });

  it("declares the built-in card properties from the spec table (E25)", () => {
    const want: Record<string, { kind: string; cost: number; persistent?: true; replacesContent?: true }> = {
      "slide-layer": { kind: "layer", cost: 2, replacesContent: true },
      "frame-chrome": { kind: "layer", cost: 1, persistent: true },
      art3d: { kind: "layer", cost: 1 },
      icon3d: { kind: "layer", cost: 1 },
      haze: { kind: "background", cost: 1 },
    };
    for (const [id, w] of Object.entries(want)) {
      const c = cards.find((x) => x.id === id) as Card;
      expect(c, id).toBeDefined();
      expect({ kind: c.kind, cost: c.cost, persistent: c.persistent, replacesContent: c.replacesContent }, id).toEqual({
        kind: w.kind,
        cost: w.cost,
        persistent: w.persistent,
        replacesContent: w.replacesContent,
      });
      expect(c.modes).toBe("both");
      expect(c.licence).toBe("MIT");
      expect(c.source).toMatch(/^https:\/\//);
      expect(c.conflicts).toEqual([]);
      expect(c.tags.topic, `${id} must not be auto-picked`).toBeUndefined();
      expect(STUB_PARAMS[id], `${id} needs preview params`).toBeDefined();
    }
  });

  it("still exercises the local-effect pipeline with exactly one pinned module", () => {
    const local = [...placements.keys()].filter((id) => id.startsWith("local:"));
    expect(local).toEqual(["local:closing-mark"]);
    const ref = merged.slides.flatMap((s) => s.effects ?? []).find((e) => e.id === "local:closing-mark");
    expect(ref?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
