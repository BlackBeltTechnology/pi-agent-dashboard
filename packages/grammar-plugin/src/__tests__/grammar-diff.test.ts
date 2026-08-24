import { describe, expect, it } from "vitest";
import { type DiffSegment, diffTokens } from "../grammar-diff.js";

/** Reconstruct the original from equal+delete segments. */
function toOriginal(segs: DiffSegment[]): string {
  return segs.filter((s) => s.type !== "insert").map((s) => s.value).join("");
}
/** Reconstruct the replacement from equal+insert segments. */
function toReplacement(segs: DiffSegment[]): string {
  return segs.filter((s) => s.type !== "delete").map((s) => s.value).join("");
}
/** Highlighted (changed) character count — lower = tighter. */
function highlighted(segs: DiffSegment[]): number {
  return segs.filter((s) => s.type !== "equal").reduce((n, s) => n + s.value.length, 0);
}

describe("diffTokens", () => {
  const CASES: Array<{ name: string; original: string; replacement: string }> = [
    {
      name: "single word mid long sentence",
      original: "I think we should probably consider using the new approach for this problem",
      replacement: "I think we should probably consider adopting the new approach for this problem",
    },
    {
      name: "two separate edits far apart",
      original: "The server recieve the request and then it send back a response to the client",
      replacement: "The server receives the request and then it sends back a response to the client",
    },
    { name: "fused punctuation", original: "I think it work.", replacement: "I think it works." },
  ];

  for (const c of CASES) {
    it(`round-trips "${c.name}"`, () => {
      const segs = diffTokens(c.original, c.replacement);
      expect(toOriginal(segs)).toBe(c.original);
      expect(toReplacement(segs)).toBe(c.replacement);
    });
  }

  it("keeps unchanged words out of the highlight for a long sentence", () => {
    const segs = diffTokens(
      "I think we should probably consider using the new approach for this problem",
      "I think we should probably consider adopting the new approach for this problem",
    );
    // Only `using` (5) + `adopting` (8) are highlighted — not the whole sentence.
    expect(highlighted(segs)).toBe("using".length + "adopting".length);
    expect(segs.some((s) => s.type === "equal" && s.value.includes("the new approach"))).toBe(true);
  });

  it("splits fused punctuation so only the word changes", () => {
    const segs = diffTokens("it work.", "it works.");
    // The trailing period stays in an equal segment.
    expect(segs.find((s) => s.type === "delete")?.value).toBe("work");
    expect(segs.find((s) => s.type === "insert")?.value).toBe("works");
    expect(segs.some((s) => s.type === "equal" && s.value.includes("."))).toBe(true);
  });
});
