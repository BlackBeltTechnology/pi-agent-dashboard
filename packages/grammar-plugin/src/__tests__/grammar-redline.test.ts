import type { GrammarSuggestion } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { describe, expect, it } from "vitest";
import { buildRedlineSegments } from "../grammar-redline.js";

/** Build a suggestion; `length` defaults to `original.length`, `offset` to 0. */
function sug(over: Partial<GrammarSuggestion> & { original: string; replacement: string }): GrammarSuggestion {
  return {
    id: over.id ?? over.original,
    offset: over.offset ?? 0,
    length: over.length ?? over.original.length,
    kind: over.kind ?? "grammar",
    message: over.message ?? "",
    ...over,
  };
}

/** Reconstruct the original text from segments (unchanged + each change.original). */
function joinOriginal(segs: ReturnType<typeof buildRedlineSegments>): string {
  return segs.map((s) => (s.type === "unchanged" ? s.text : s.suggestion.original)).join("");
}
/** Reconstruct the fully-corrected text (unchanged + each change.replacement). */
function joinCorrected(segs: ReturnType<typeof buildRedlineSegments>): string {
  return segs.map((s) => (s.type === "unchanged" ? s.text : s.suggestion.replacement)).join("");
}

describe("buildRedlineSegments", () => {
  it("locates a suggestion by its recorded offset", () => {
    const segs = buildRedlineSegments("teh cat", [sug({ original: "teh", replacement: "the", offset: 0 })]);
    expect(segs).toEqual([
      { type: "change", suggestion: expect.objectContaining({ original: "teh" }), start: 0, end: 3 },
      { type: "unchanged", text: " cat" },
    ]);
  });

  it("falls back to indexOf when the offset has drifted", () => {
    // slice(0,3) = "a t" ≠ "teh"; must forward-search.
    const segs = buildRedlineSegments("a teh cat", [sug({ original: "teh", replacement: "the", offset: 0 })]);
    expect(segs.map((s) => (s.type === "change" ? [s.start, s.end] : s.text))).toEqual([
      "a ",
      [2, 5],
      " cat",
    ]);
  });

  it("drops a suggestion whose original cannot be located (stale)", () => {
    const segs = buildRedlineSegments("hello world", [sug({ original: "xyz", replacement: "abc" })]);
    expect(segs).toEqual([{ type: "unchanged", text: "hello world" }]);
  });

  it("drops a suggestion with an empty original", () => {
    const segs = buildRedlineSegments("hello", [sug({ original: "", replacement: "x" })]);
    expect(segs).toEqual([{ type: "unchanged", text: "hello" }]);
  });

  it("keeps two adjacent changes with no unchanged run between", () => {
    const segs = buildRedlineSegments("ab", [
      sug({ id: "a", original: "a", replacement: "A", offset: 0 }),
      sug({ id: "b", original: "b", replacement: "B", offset: 1 }),
    ]);
    expect(segs.map((s) => (s.type === "change" ? s.suggestion.id : `_${s.text}_`))).toEqual(["a", "b"]);
    expect(joinOriginal(segs)).toBe("ab");
    expect(joinCorrected(segs)).toBe("AB");
  });

  it("treats a multi-word original as one span", () => {
    const segs = buildRedlineSegments("please make it work good now", [
      sug({ original: "work good", replacement: "work well" }),
    ]);
    const change = segs.find((s) => s.type === "change");
    expect(change && change.type === "change" && change.suggestion.original).toBe("work good");
    expect(joinCorrected(segs)).toBe("please make it work well now");
  });

  it("keeps punctuation fused to the word", () => {
    const segs = buildRedlineSegments("it work.", [sug({ original: "work.", replacement: "works." })]);
    expect(joinCorrected(segs)).toBe("it works.");
  });

  it("drops an overlapping span, keeping the earlier one", () => {
    const segs = buildRedlineSegments("abcdef", [
      sug({ id: "abc", original: "abc", replacement: "ABC", offset: 0 }),
      sug({ id: "bcd", original: "bcd", replacement: "BCD", offset: 1 }),
    ]);
    expect(segs.map((s) => (s.type === "change" ? s.suggestion.id : s.text))).toEqual(["abc", "def"]);
  });

  it("returns a single unchanged segment when there are no suggestions", () => {
    expect(buildRedlineSegments("nothing to fix", [])).toEqual([
      { type: "unchanged", text: "nothing to fix" },
    ]);
  });

  it("round-trips the whole draft (unchanged+original == draft; unchanged+replacement == corrected)", () => {
    const draft = "i beleive their are alot of things that dont work good.";
    const specs: Array<[string, string]> = [
      ["i", "I"],
      ["beleive", "believe"],
      ["their", "there"],
      ["alot", "a lot"],
      ["dont", "don't"],
      ["work good", "work well"],
    ];
    const suggestions = specs.map(([original, replacement], i) =>
      sug({ id: `s${i}`, original, replacement, offset: draft.indexOf(original) }),
    );
    const segs = buildRedlineSegments(draft, suggestions);
    expect(joinOriginal(segs)).toBe(draft);
    expect(joinCorrected(segs)).toBe("I believe there are a lot of things that don't work well.");
  });
});
