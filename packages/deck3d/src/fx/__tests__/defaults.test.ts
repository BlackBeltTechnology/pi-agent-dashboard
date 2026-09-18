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
