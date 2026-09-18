import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { catalogueHash, renderCatalogue } from "../catalogue.js";
import { FX_IDS, REGISTRY } from "../index.js";
import { PERMISSIVE_LICENCES } from "../types.js";

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

  it("rejects a non-permissive licence at the schema level (E28)", () => {
    const validate = ajv.compile(cardSchema);
    const card = { ...REGISTRY.bloom.card, id: "bad", licence: "CC-BY-NC-SA-4.0" };
    expect(validate(card)).toBe(false);
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
