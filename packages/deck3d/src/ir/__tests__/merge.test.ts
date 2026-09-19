import { describe, expect, it } from "vitest";
import { applyOverrides, deepMerge, findOrphanOverrides, orphanOverridePath } from "../merge.js";
import { flowchartIR, validIR } from "./fixtures.js";

describe("deepMerge", () => {
  it("deep-merges objects and replaces arrays", () => {
    const base = { a: { b: 1, c: 2 }, list: [1, 2] };
    const over = { a: { c: 9 }, list: [3] };
    expect(deepMerge(base, over)).toEqual({ a: { b: 1, c: 9 }, list: [3] });
  });
});

describe("applyOverrides (E9 grammar)", () => {
  it("replaces effect arrays and deep-merges camera objects, leaving derived slides untouched", () => {
    const ir = validIR();
    ir.slides[0].effects = [{ id: "tokens" }, { id: "fog" }];
    ir.slides[0].camera = { distance: 7 };
    ir.overrides.slides = { intro: { effects: [{ id: "starfield" }], camera: { distance: 9 } } };

    const merged = applyOverrides(ir);
    expect(merged.slides[0].effects).toEqual([{ id: "starfield" }]);
    expect(merged.slides[0].camera).toEqual({ distance: 9 });

    // persisted derived slide is unchanged
    expect(ir.slides[0].effects).toEqual([{ id: "tokens" }, { id: "fog" }]);
    expect(ir.slides[0].camera).toEqual({ distance: 7 });
  });

  it("applies a node shape override to the merged node", () => {
    const ir = flowchartIR();
    ir.overrides.nodes = { "intro/A": { shape: "hexagon", position: { z: 0.4 } } };
    const merged = applyOverrides(ir);
    const node = merged.slides[0].diagram.nodes!.find((n) => n.id === "A")!;
    expect(node.shape).toBe("hexagon");
    expect(node.position).toEqual({ z: 0.4 });
    expect(ir.slides[0].diagram.nodes!.find((n) => n.id === "A")!.shape).toBe("rect");
  });
});

describe("findOrphanOverrides", () => {
  it("flags a node override whose target is gone (E6)", () => {
    const ir = flowchartIR();
    ir.overrides.nodes = { "intro/Z": { shape: "hexagon" } };
    const orphans = findOrphanOverrides(ir);
    expect(orphans).toHaveLength(1);
    expect(orphanOverridePath(orphans[0])).toBe('overrides.nodes["intro/Z"]');
  });

  it("flags a slide override whose slug vanished", () => {
    const ir = validIR();
    ir.overrides.slides = { "old-title": { mode: "light" } };
    const orphans = findOrphanOverrides(ir);
    expect(orphans.map(orphanOverridePath)).toContain('overrides.slides["old-title"]');
  });
});
