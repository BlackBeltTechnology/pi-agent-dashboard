import { describe, expect, it } from "vitest";
import { applyOverrides } from "../../ir/merge.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { composeEffects, QUALITY_BUDGET, validateEffectParams } from "../compose.js";
import { defaultEffectsFor } from "../defaults.js";

const stubHarvest = async () => ({
  diagram: {
    kind: "sequence" as const,
    actors: [
      { id: "A", label: "A" },
      { id: "B", label: "B" },
    ],
    messages: [{ id: "m0", from: "A", to: "B", text: "x", kind: "solid" as const }],
  },
});

describe("composition (E21/E22/E23)", () => {
  it("warns when a slide's cost exceeds its quality budget (E21)", () => {
    const under = composeEffects([{ id: "bloom" }, { id: "film" }, { id: "smaa" }], "dark", "low", "s1");
    expect(under.warnings.filter((w) => w.includes("budget"))).toHaveLength(0);

    const over = composeEffects(
      [{ id: "bloom" }, { id: "film" }, { id: "vignette" }, { id: "smaa" }, { id: "camera-drift" }],
      "dark",
      "low",
      "s1",
    );
    expect(over.warnings.some((w) => w === `warn budget slide s1 ${7} > ${QUALITY_BUDGET.low}`)).toBe(true);
  });

  it("fails on conflicting effects naming both ids and the slide (E22)", () => {
    const comp = composeEffects([{ id: "depth-of-field" }, { id: "god-rays" }], "dark", "high", "arch");
    expect(comp.conflicts).toHaveLength(1);
    expect(comp.conflicts[0]).toContain("depth-of-field");
    expect(comp.conflicts[0]).toContain("god-rays");
    expect(comp.conflicts[0]).toContain("arch");
  });

  it("skips mode-incompatible effects with a warning (E23)", () => {
    const comp = composeEffects([{ id: "glyph-rain" }, { id: "bloom" }], "light", "high", "intro");
    expect(comp.active.map((e) => e.id)).toEqual(["bloom"]);
    expect(comp.skipped).toEqual([{ id: "glyph-rain", reason: "dark only" }]);
    expect(comp.warnings).toContain("warn skipped glyph-rain (dark only) slide intro");
  });

  it("rejects out-of-range params naming the overrides path (E24)", () => {
    const inRange = validateEffectParams({
      overrides: { slides: { s1: { effects: [{ id: "starfield", params: { density: 0 } }] } } },
    });
    expect(inRange).toHaveLength(0);
    const tooHigh = validateEffectParams({
      overrides: { slides: { s1: { effects: [{ id: "starfield", params: { density: 1.5 } }] } } },
    });
    expect(tooHigh[0].path).toBe('overrides.slides["s1"].effects[0].params.density');
    expect(tooHigh[0].message).toContain("maximum");
  });
});

describe("override replaces defaults (E26)", () => {
  it("keeps a slide effects override across a re-parse", async () => {
    const md = "# Folyamat\n\n```mermaid\nsequenceDiagram\n  A->>B: x\n```\n";
    const first = await deriveDeckIR(parseMarkdown(md), { harvest: stubHarvest, effectsForSlide: defaultEffectsFor });
    expect(first.ir.slides[0].effects?.map((e) => e.id)).toEqual(["rings", "signal-pulse"]);

    first.ir.overrides.slides = { folyamat: { effects: [{ id: "starfield" }] } };
    const merged = applyOverrides(first.ir);
    expect(merged.slides[0].effects?.map((e) => e.id)).toEqual(["starfield"]);

    const second = await deriveDeckIR(parseMarkdown(md), {
      harvest: stubHarvest,
      effectsForSlide: defaultEffectsFor,
      previous: first.ir,
    });
    expect(second.ir.overrides.slides?.folyamat.effects?.[0].id).toBe("starfield");
  });
});
