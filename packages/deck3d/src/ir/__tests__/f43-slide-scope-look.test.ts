/**
 * Look knobs are overridable PER SLIDE, not deck-only.
 *
 * The configurator offered 16 look knobs (`fog`, `bloom`, `floorMatte`,
 * `floorReflectivity`, `mirrorFloor`, `floor`, `reflectBackdrop`, `rimLight`,
 * `softShadows`, `envReflections`, `depthRelief`, `extrudeDepth`, `colors`,
 * `durationSec`, …) at slide scope and applied them live, but the IR rejected
 * every one of them on export — `error overrides.slides["a"]: unknown key
 * 'fog'`. The panel could therefore produce a deck that would not render.
 *
 * The runtime always supported it: `effective()` is `{...defaults, ...slide}`,
 * so a key merged onto the slide already wins. Only the schema forbade it.
 *
 * `rail` and `spacing` stay DECK-ONLY on purpose: they position every anchor
 * on the rail, so "this slide only" is not a meaning they have.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../__tests__/helpers/local-fx.js";
import { applyOverrides } from "../merge.js";
import type { DeckIR } from "../types.js";
import { validate } from "../validate.js";

/** A real parsed deck — a hand-built IR drifts from the schema's required keys. */
const BASE: DeckIR = (() => {
  const dir = mkdtempSync(join(tmpdir(), "deck3d-slide-scope-"));
  writeFileSync(join(dir, "deck.md"), "# A\n\nBody.\n\n- one\n");
  expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir).status).toBe(0);
  return JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as DeckIR;
})();

/** Per-slide look keys the panel exposes and the IR must now accept. */
const SLIDE_LOOK_KEYS = [
  "bloom",
  "rimLight",
  "fog",
  "floor",
  "mirrorFloor",
  "reflectBackdrop",
  "floorMatte",
  "floorReflectivity",
  "softShadows",
  "envReflections",
  "depthRelief",
  "extrudeDepth",
  "colors",
  "durationSec",
] as const;

const SAMPLE: Record<string, unknown> = {
  bloom: false,
  rimLight: false,
  fog: false,
  floor: "water",
  mirrorFloor: false,
  reflectBackdrop: false,
  floorMatte: 0.4,
  floorReflectivity: 0.25,
  softShadows: false,
  envReflections: false,
  depthRelief: 0.3,
  extrudeDepth: 0.4,
  colors: { accent: "#ff0000" },
  durationSec: 3,
};

function deck(slideOverride: Record<string, unknown>): DeckIR {
  const ir = JSON.parse(JSON.stringify(BASE)) as DeckIR;
  const id = ir.slides[0].id;
  ir.overrides = { ...ir.overrides, slides: { ...(ir.overrides?.slides ?? {}), [id]: slideOverride } };
  return ir;
}

/** Schema errors only — warnings are not a rejection. */
const schemaErrors = (ir: DeckIR): string[] => validate(ir).errors.map((e) => `${e.path}: ${e.message}`);

describe("F43 per-slide look overrides", () => {
  for (const key of SLIDE_LOOK_KEYS) {
    it(`accepts overrides.slides[id].${key}`, () => {
      expect(schemaErrors(deck({ [key]: SAMPLE[key] })), `${key} must be valid at slide scope`).toEqual([]);
    });
  }

  it("keeps rail and spacing deck-only — they move every anchor", () => {
    expect(schemaErrors(deck({ rail: "orbit" })).join(" ")).toMatch(/unknown key 'rail'/);
    expect(schemaErrors(deck({ spacing: 60 })).join(" ")).toMatch(/unknown key 'spacing'/);
  });

  it("lands the slide value on the slide, where it beats the deck default", () => {
    const ir = deck({ fog: false, floorMatte: 0.4 });
    (ir.defaults as Record<string, unknown>).fog = true;
    (ir.defaults as Record<string, unknown>).floorMatte = 0;
    const merged = applyOverrides(ir);
    const slide = merged.slides[0] as unknown as Record<string, unknown>;
    expect(validate(ir).errors, "fixture must be schema-valid").toEqual([]);
    // `effective()` spreads the slide over the defaults, so these win.
    expect(slide.fog).toBe(false);
    expect(slide.floorMatte).toBe(0.4);
    expect(merged.defaults.fog, "the deck default is untouched").toBe(true);
  });
});
