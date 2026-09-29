/**
 * E27 (task 10.27) — effects: Corpus size and licence audit (set equality).
 *
 * Every card on disk (`src/fx/*.meta.json`) is audited: the 15 strategy-lab
 * mockup ids plus every ported id exist, every `licence` is on the permissive
 * SPDX allow-list, every `source` is an `https://` URL, and the regenerated
 * `reference/effects.md` is byte-equal to the committed file.
 *
 * Cards are read from disk (not just the registry) so an unregistered card
 * still fails the audit.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderCatalogue } from "../catalogue.js";
import { FX_IDS, REGISTRY } from "../index.js";
import { FX_TOPICS, PERMISSIVE_LICENCES } from "../types.js";

const FX_DIR = new URL("../", import.meta.url);
const COMMITTED_CATALOGUE = new URL("../../../.pi/skills/deck3d/reference/effects.md", import.meta.url);

/** The 15 effects the strategy-lab mockup already used (spec: v1 corpus). */
const MOCKUP_IDS = [
  "tokens",
  "rings",
  "swarm",
  "particles",
  "bloom",
  "film",
  "glass",
  "metal",
  "emissive",
  "mirror-floor",
  "fog",
  "soft-shadows",
  "room-ibl",
  "signal-pulse",
  "dolly",
];

/** Effects ported on top of the mockup (spec: v1 corpus). */
const PORTED_IDS = [
  "starfield",
  "aurora",
  "grid-horizon",
  "hex-grid",
  "data-columns",
  "glyph-rain",
  "constellation",
  "vignette",
  "chromatic-aberration",
  "depth-of-field",
  "god-rays",
  "sao",
  "selective-bloom",
  "smaa",
  "holo-fresnel",
  "wireframe-overlay",
  "iridescent",
  "matcap",
  "lightformers",
  "accent-cycle",
  "volumetric-spot",
  "float",
  "orbit",
  "stagger-reveal",
  "trail",
  "camera-drift",
  "dashed-flow",
  "glow-tube",
  "particle-stream",
  "fade",
  "iris",
  "flythrough",
];

interface Card {
  id: string;
  licence: string;
  source: string;
}

const cardFiles = readdirSync(FX_DIR).filter((f) => f.endsWith(".meta.json"));
const cards = cardFiles.map(
  (file) => [file, JSON.parse(readFileSync(new URL(file, FX_DIR), "utf8")) as Card] as const,
);

describe("E27 corpus size and licence audit", () => {
  it("ships at least the 15 mockup ids plus every ported id", () => {
    expect(MOCKUP_IDS.length).toBeGreaterThanOrEqual(15);
    for (const id of [...MOCKUP_IDS, ...PORTED_IDS]) expect(FX_IDS, id).toContain(id);
    expect(FX_IDS.length).toBeGreaterThanOrEqual(MOCKUP_IDS.length + PORTED_IDS.length);
  });

  it("audits a card per meta file, keyed by its own id", () => {
    expect(cardFiles.length).toBe(FX_IDS.length);
    for (const [file, card] of cards) {
      expect(card.id, file).toBe(file.replace(/\.meta\.json$/, ""));
    }
  });

  it("admits only the permissive SPDX allow-list", () => {
    // The plan's set is a subset of the constant of record.
    for (const spdx of ["MIT", "Zlib", "CC0-1.0", "BSD-2-Clause", "BSD-3-Clause", "OFL-1.1"]) {
      expect(PERMISSIVE_LICENCES).toContain(spdx);
    }
    for (const [file, card] of cards) {
      expect(PERMISSIVE_LICENCES as readonly string[], `${file}: ${card.licence}`).toContain(card.licence);
    }
  });

  it("records an https source for every card", () => {
    for (const [file, card] of cards) {
      expect(card.source, file).toMatch(/^https:\/\//);
    }
  });

  it("regenerates reference/effects.md byte-equal to the committed file", () => {
    expect(renderCatalogue()).toBe(readFileSync(COMMITTED_CATALOGUE, "utf8"));
  });
});

/**
 * test-plan #E30 — parse routes a content slide by topic, so a topic with no
 * background card is a routing dead end: the slide silently falls through to
 * the generic fallback. Coverage is therefore a corpus invariant.
 */
describe("E30 every topic has a background card", () => {
  const registry = Object.values(REGISTRY);

  it.each(FX_TOPICS)("topic %s has at least one background card", (topic) => {
    const owners = registry.filter((e) => e.card.kind === "background" && e.card.tags.topic?.includes(topic));
    expect(owners.map((e) => e.card.id)).not.toHaveLength(0);
  });
});
