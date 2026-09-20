import { describe, expect, it } from "vitest";
import type { Diagram } from "../../ir/types.js";
import { defaultEffectsFor } from "../defaults.js";

const none: Diagram = { kind: "none" };
const flowchart: Diagram = { kind: "flowchart", dir: "LR" };
const sequence: Diagram = { kind: "sequence" };

describe("deterministic effect defaults (E25)", () => {
  it("maps title, diagram kind and keywords to a fixed list", () => {
    expect(defaultEffectsFor({ id: "intro", title: "Az LLM-től", bullets: [], diagram: none }).map((e) => e.id)).toEqual(["swarm"]);
    expect(defaultEffectsFor({ id: "arch", title: "Architecture", bullets: ["a"], diagram: flowchart }).map((e) => e.id)).toEqual([
      "tokens",
      "signal-pulse",
    ]);
    expect(defaultEffectsFor({ id: "seq", title: "Javítás", bullets: ["b"], diagram: sequence }).map((e) => e.id)).toEqual([
      "rings",
      "signal-pulse",
    ]);
    expect(defaultEffectsFor({ id: "sec", title: "Security hardening", bullets: [], diagram: none }).map((e) => e.id)).toEqual(["glyph-rain"]);
  });

  it("is identical across runs", () => {
    const input = { id: "seq", title: "Javítási ciklus", bullets: ["x"], diagram: sequence };
    expect(JSON.stringify(defaultEffectsFor(input))).toBe(JSON.stringify(defaultEffectsFor(input)));
  });
});

/**
 * test-plan #E32 — the D3 precedence. The v1 rows must still outrank the new
 * topic step (so existing decks do not move), and the topic step must only
 * catch slides that previously fell through to `particles`.
 */
describe("E32 topic routing sits below the v1 rows", () => {
  const content = (title: string, bullets: string[] = ["one", "two", "three"]) => ({
    id: "s",
    title,
    bullets,
    diagram: none,
  });

  it("keeps the v1 keyword row above a harvested diagram", () => {
    const slide = { id: "sec", title: "Security data flows", bullets: ["a"], diagram: flowchart };
    expect(defaultEffectsFor(slide).map((e) => e.id)).toEqual(["glyph-rain", "signal-pulse"]);
  });

  it("keeps the v1 keyword row above the title-ish row", () => {
    expect(defaultEffectsFor({ id: "dp", title: "Data Platform 2030", bullets: [], diagram: none }).map((e) => e.id)).toEqual([
      "data-columns",
    ]);
  });

  it("routes a content slide by topic where v1 fell through to particles", () => {
    expect(defaultEffectsFor(content("Regional trade shifts")).map((e) => e.id)).toEqual(["globe-arcs"]);
  });

  it("restores the v1 fallback when autoStyle is off", () => {
    expect(defaultEffectsFor(content("Regional trade shifts"), false).map((e) => e.id)).toEqual(["particles"]);
  });

  it("still falls through to particles when no topic matches", () => {
    expect(defaultEffectsFor(content("Weather")).map((e) => e.id)).toEqual(["particles"]);
  });
});
