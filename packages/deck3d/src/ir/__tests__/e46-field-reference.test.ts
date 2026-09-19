/**
 * E46 (task 10.46) — ir: Field reference documented.
 *
 * The committed `reference/ir-fields.md` equals the file generated from
 * `schema.json`, and every schema leaf appears exactly once as a table row.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectFieldPaths, renderIrFieldsMd } from "../field-reference.js";

// `.pi/skills/deck3d/reference/ir-fields.md` — resolved from `src/ir/__tests__/`.
const COMMITTED = new URL("../../../.pi/skills/deck3d/reference/ir-fields.md", import.meta.url);

describe("E46 IR field reference", () => {
  it("the committed reference matches the schema generator exactly", () => {
    expect(readFileSync(COMMITTED, "utf8")).toBe(renderIrFieldsMd());
  });

  it("lists every schema leaf exactly once as a table row", () => {
    const md = renderIrFieldsMd();
    const paths = collectFieldPaths().map((row) => row.path);

    // No duplicated leaf path.
    expect(new Set(paths).size).toBe(paths.length);

    // One `| \`path\` | ...` table row per leaf.
    const rows = md.split("\n").filter((line) => line.startsWith("| `"));
    expect(rows).toHaveLength(paths.length);

    for (const path of paths) {
      expect(md.split(`\`${path}\``).length - 1, `leaf ${path}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("documents the override-grammar knobs an editing agent tunes", () => {
    const paths = collectFieldPaths().map((row) => row.path);
    expect(paths).toContain('overrides.slides["<key>"].diagram.scale');
    expect(paths).toContain('overrides.slides["<key>"].camera.distance');
    expect(paths).toContain('overrides.nodes["<key>"].shape');
  });
});
