import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { contrastRatio, luminanceFromHex } from "../../check/rules.js";
import { PALETTES, resolvePalette } from "../../runtime/palette.js";
import { qualityProfile } from "../../runtime/quality.js";
import { makeRng } from "../../runtime/rng.js";
import { catalogueHash, renderCatalogue } from "../catalogue.js";
import { FX_IDS, REGISTRY } from "../index.js";
import { FX_TOPICS, PERMISSIVE_LICENCES } from "../types.js";

const REQUIRED = [
  "tokens", "rings", "swarm", "particles", "bloom", "film", "glass", "metal", "emissive",
  "mirror-floor", "fog", "soft-shadows", "room-ibl", "signal-pulse", "dolly",
  "starfield", "aurora", "grid-horizon", "hex-grid", "data-columns", "glyph-rain", "constellation",
  "vignette", "chromatic-aberration", "depth-of-field", "god-rays", "n8ao", "selective-bloom", "smaa",
  "holo-fresnel", "wireframe-overlay", "iridescent", "matcap",
  "lightformers", "accent-cycle", "volumetric-spot",
  "float", "orbit", "stagger-reveal", "trail", "camera-drift",
  "dashed-flow", "glow-tube", "particle-stream",
  "fade", "iris", "flythrough",
];

describe("effect corpus (E27/E28)", () => {
  const cardSchema = JSON.parse(readFileSync(new URL("../meta.schema.json", import.meta.url), "utf8"));
  const ajv = new Ajv({ allErrors: true });

  it("contains every required v1 id with a valid card", () => {
    for (const id of REQUIRED) expect(FX_IDS, id).toContain(id);
    const validate = ajv.compile(cardSchema);
    for (const { card } of Object.values(REGISTRY)) {
      expect(validate(card), `${card.id}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  it("admits only permissive licences and https sources", () => {
    for (const { card } of Object.values(REGISTRY)) {
      expect(PERMISSIVE_LICENCES, card.id).toContain(card.licence);
      expect(card.source, card.id).toMatch(/^https:\/\//);
    }
  });

  // test-plan #E29 — `tags.topic` is the routing key parse reads, so an
  // off-vocabulary topic must fail at the card, not silently never match.
  it("rejects an off-vocabulary topic and accepts a listed one (E29)", () => {
    const validate = ajv.compile(cardSchema);
    const base = REGISTRY.starfield.card;
    expect(validate({ ...base, id: "bad", tags: { ...base.tags, topic: ["finance"] } })).toBe(false);
    expect(ajv.errorsText(validate.errors)).toMatch(/topic/);
    expect(validate({ ...base, id: "ok", tags: { ...base.tags, topic: ["geo"] } })).toBe(true);
  });

  // A corpus card is public and must carry its upstream; `local` is reserved
  // for per-deck modules in `fx/`, which the schema admits but the corpus does not.
  it("rejects source 'local' for a shipped corpus card (E29)", () => {
    for (const { card } of Object.values(REGISTRY)) expect(card.source, card.id).not.toBe("local");
    const validate = ajv.compile(cardSchema);
    expect(validate({ ...REGISTRY.starfield.card, id: "loc", source: "local" })).toBe(true);
  });

  // test-plan #E31 — the context grew (`rng`, `slide`); every shipped effect
  // must still construct and dispose with the full context.
  it("constructs and disposes every effect with the extended context (E31)", () => {
    const ctx = {
      THREE,
      palette: resolvePalette({ palette: "blackbelt", mode: "dark" }),
      mode: "dark" as const,
      quality: qualityProfile("high"),
      rng: makeRng(1),
      slide: { id: "s1", title: "Slide", kind: "content" },
    };
    for (const { card, create } of Object.values(REGISTRY)) {
      expect(() => {
        const handle = create(ctx, {});
        handle.tick?.(0);
        handle.dispose();
      }, card.id).not.toThrow();
    }
  });

  it("rejects a non-permissive licence at the schema level (E28)", () => {
    const validate = ajv.compile(cardSchema);
    const card = { ...REGISTRY.bloom.card, id: "bad", licence: "CC-BY-NC-SA-4.0" };
    expect(validate(card)).toBe(false);
  });
});

/**
 * test-plan #E45 — a palette that fails AA as body text cannot ship. Computed
 * from the table, not eyeballed, so a new palette is gated at commit time.
 */
describe("E45 palette text/bg contrast", () => {
  const MIN = 4.5;
  const cases = Object.entries(PALETTES).flatMap(([name, def]) =>
    (["dark", "light"] as const).map((mode) => ({ name, mode, ...def[mode] })),
  );

  it("covers all nine named palettes in both modes", () => {
    expect(cases).toHaveLength(18);
  });

  it.each(cases)("$name/$mode text on bg meets AA", ({ text, bg }) => {
    const ratio = contrastRatio(luminanceFromHex(text), luminanceFromHex(bg));
    expect(ratio).toBeGreaterThanOrEqual(MIN);
  });

  it.each(cases)("$name/$mode text on card meets AA", ({ text, card }) => {
    const ratio = contrastRatio(luminanceFromHex(text), luminanceFromHex(card));
    expect(ratio).toBeGreaterThanOrEqual(MIN);
  });
});

describe("generated catalogue (E47)", () => {
  it("matches the committed reference/effects.md and lists every id", () => {
    const generated = renderCatalogue();
    const committed = readFileSync(new URL("../../../.pi/skills/deck3d/reference/effects.md", import.meta.url), "utf8");
    expect(generated).toBe(committed);
    for (const id of FX_IDS) expect(generated).toContain(`## ${id}`);
    expect(catalogueHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});
