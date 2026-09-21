import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectFieldPaths, renderIrFieldsMd } from "../field-reference.js";

describe("IR field reference", () => {
  it("committed reference matches the generator (E46)", () => {
    const committed = readFileSync(new URL("../../../.pi/skills/deck3d/reference/ir-fields.md", import.meta.url), "utf8");
    expect(committed).toBe(renderIrFieldsMd());
  });

  it("lists every schema property exactly once", () => {
    const md = renderIrFieldsMd();
    const paths = collectFieldPaths().map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      const occurrences = md.split(`\`${path}\``).length - 1;
      expect(occurrences, `path ${path}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("documents the override grammar knobs an agent tunes", () => {
    const paths = collectFieldPaths().map((r) => r.path);
    expect(paths).toContain('overrides.slides["<key>"].diagram.scale');
    expect(paths).toContain('overrides.slides["<key>"].camera.distance');
    expect(paths).toContain('overrides.slides["<key>"].labels.size');
    expect(paths).toContain('overrides.slides["<key>"].check.ignore[]');
    expect(paths).toContain('overrides.nodes["<key>"].shape');
  });
});
