import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  contrastFindings,
  fitFindings,
  formatFinding,
  iou,
  legibilityFindings,
  type Measurement,
  occlusionFindings,
  overlapFindings,
  type SlideRef,
} from "../rules.js";

const SLIDE: SlideRef = { id: "arch", index: 2 };

function label(id: string, rect: { x: number; y: number; w: number; h: number }, capHeight: number, extra: Partial<Measurement> & { bgLuminance?: number } = {}): Measurement & { bgLuminance?: number } {
  return { kind: "label", id, text: id, rect, capHeight, ...extra };
}

describe("legibility (E37)", () => {
  it("scales the 14px threshold by viewport height", () => {
    const m = [label("a", { x: 0, y: 0, w: 10, h: 10 }, 14), label("b", { x: 0, y: 0, w: 10, h: 10 }, 13.99)];
    expect(legibilityFindings(m, 1080, SLIDE).map((f) => f.id)).toEqual(["b"]);

    const m2 = [label("c", { x: 0, y: 0, w: 10, h: 10 }, 9.34), label("d", { x: 0, y: 0, w: 10, h: 10 }, 9.33)];
    const f2 = legibilityFindings(m2, 720, SLIDE);
    expect(f2.map((f) => f.id)).toEqual(["d"]);
    expect(f2[0].severity).toBe("warn");
    expect(f2[0].suggest).toBe('overrides.slides["arch"].labels.size');
  });
});

describe("overlap (E38)", () => {
  it("fires strictly above IoU 0.1 and names both ids", () => {
    const t = (r: number) => (2 * r) / (1 + r);
    const at = (r: number): Measurement[] => [
      label("A", { x: 0, y: 0, w: 1, h: 1 }, 20),
      label("B", { x: 1 - t(r), y: 0, w: 1, h: 1 }, 20),
    ];
    expect(iou(at(0.1)[0].rect, at(0.1)[1].rect)).toBeCloseTo(0.1, 6);
    expect(overlapFindings(at(0.1), SLIDE)).toHaveLength(0);
    const f = overlapFindings(at(0.1001), SLIDE);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("error");
    expect(f[0].detail).toContain("A ∩ B");
  });
});

describe("fit (E39)", () => {
  const viewport = { w: 1920, h: 1080 };
  it("applies the 4% safe margin and suggests diagram.scale", () => {
    const pass = fitFindings([label("A", { x: 100, y: 100, w: 1743, h: 100 }, 20)], viewport, SLIDE);
    expect(pass).toHaveLength(0);

    const fail = fitFindings([label("A", { x: 100, y: 100, w: 1744, h: 100 }, 20)], viewport, SLIDE);
    expect(fail).toHaveLength(1);
    expect(formatFinding(fail[0])).toBe("error fit slide 2 right 1844px > 1843px");
    expect(fail[0].suggest).toBe('overrides.slides["arch"].diagram.scale');
  });
});

describe("occlusion", () => {
  it("flags a label hit by a foreign object but not its own node", () => {
    const own = occlusionFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { hit: "A" })], SLIDE);
    expect(own).toHaveLength(0);
    const foreign = occlusionFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { hit: "B" })], SLIDE);
    expect(foreign).toHaveLength(1);
    expect(foreign[0].detail).toContain("A occluded by B");
  });
});

describe("contrast", () => {
  it("is warn-only and rounds the ratio", () => {
    const good = contrastFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { color: "#ffffff", bgLuminance: 0 })], SLIDE);
    expect(good).toHaveLength(0);
    const bad = contrastFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { color: "#888888", bgLuminance: 0.5 })], SLIDE);
    expect(bad).toHaveLength(1);
    expect(bad[0].severity).toBe("warn");
  });
});

describe("suggestions resolve in the schema (E40)", () => {
  const schema = JSON.parse(readFileSync(new URL("../../ir/schema.json", import.meta.url), "utf8"));
  const overrides = schema.definitions.overrides.properties;

  function resolve(path: string): boolean {
    const match = /^overrides\.(slides|nodes)\["[^"]+"\]\.(.+)$/.exec(path);
    if (!match) return false;
    let node: { properties?: Record<string, unknown> } = { properties: overrides[match[1]].additionalProperties.properties };
    for (const seg of match[2].split(".")) {
      const next = node.properties?.[seg] as { properties?: Record<string, unknown> } | undefined;
      if (!next) return false;
      node = next;
    }
    return true;
  }

  const samples = [
    fitFindings([label("A", { x: 0, y: 0, w: 2000, h: 10 }, 20)], { w: 1920, h: 1080 }, SLIDE)[0],
    legibilityFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 1)], 1080, SLIDE)[0],
    overlapFindings([label("A", { x: 0, y: 0, w: 1, h: 1 }, 20), label("B", { x: 0.5, y: 0, w: 1, h: 1 }, 20)], SLIDE)[0],
    occlusionFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { hit: "B" })], SLIDE)[0],
    contrastFindings([label("A", { x: 0, y: 0, w: 10, h: 10 }, 20, { color: "#888888", bgLuminance: 0.5 })], SLIDE)[0],
  ];

  it("every kind carries an overrides key that resolves", () => {
    expect(samples.every(Boolean)).toBe(true);
    for (const f of samples) {
      expect(f.suggest).toMatch(/^overrides\./);
      expect(resolve(f.suggest), `${f.rule}: ${f.suggest}`).toBe(true);
    }
  });
});
