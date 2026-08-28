// Tests for the golden-fixture loader contract (eval.ts loadGolden).
// Folded from openspec/changes/fix-kb-eval-measurement-integrity/test-plan.md
// (E4 accepted shapes, E5 malformed rejection, E6 item validation).
// Exemplar: packages/kb/src/__tests__/kb.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGolden } from "../eval.js";

const PROVENANCE = fileURLToPath(new URL("../../eval/golden.provenance.json", import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe("loadGolden (E4 accepted shapes)", () => {
  it("a bare array loads; no provenance header on stderr", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = loadGolden([{ q: "a", expect: "b" }], "arr.json");
    expect(items).toEqual([{ q: "a", expect: "b" }]);
    expect(err).not.toHaveBeenCalled();
  });

  it("the bundled {items:[...]} shape loads; intent/minedAt header goes to stderr only", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const items = loadGolden({ intent: "markdown-intent", minedAt: "2026-08-01", n: 1, items: [{ q: "a", expect: "b" }] }, "obj.json");
    expect(items).toEqual([{ q: "a", expect: "b" }]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toContain("markdown-intent");
    expect(err.mock.calls[0][0]).toContain("2026-08-01");
  });
});

describe("loadGolden (E5 malformed rejection)", () => {
  const cases: Array<[string, unknown]> = [
    ["a bare JSON string", '"just a string"'],
    ["an empty object", {}],
    ["{items: <not an array>}", { items: "x" }],
    ["the real provenance metadata file", JSON.parse(readFileSync(PROVENANCE, "utf8"))],
  ];
  for (const [name, raw] of cases) {
    it(`${name} throws naming BOTH accepted shapes + the file`, () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => loadGolden(raw, "bad.json")).toThrow(/bare array.*items.*bad\.json/s);
    });
  }
});

describe("loadGolden (E6 item validation)", () => {
  it("a non-string q and a missing expect are rejected with file + array index (today: silent zero)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => loadGolden({ items: [{ q: 1, expect: "a" }] }, "f.json")).toThrow(/f\.json.*\[0\]/s);
    expect(() => loadGolden({ items: [{ q: "ok", expect: "x" }, { q: "x" }] }, "f.json")).toThrow(/f\.json.*\[1\]/s);
  });
});
