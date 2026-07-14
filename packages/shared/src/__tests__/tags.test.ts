/**
 * Unit tests for the shared tag primitives.
 *   - `normalizeTags` — trim/lowercase/dedupe/blank-drop/truncate/cap.
 *   - `tagColor` / `fnv1a32` — deterministic palette index over UTF-8 bytes
 *     (asserts the exact index for an ASCII AND a non-ASCII input, proving the
 *     `TextEncoder` byte source vs. `charCodeAt` UTF-16 code units).
 * See change: add-session-tags.
 */
import { describe, expect, it } from "vitest";
import {
  fnv1a32,
  MAX_TAG_LEN,
  MAX_TAGS,
  normalizeTags,
  TAG_PALETTE,
  tagColor,
} from "../tags.js";

describe("normalizeTags", () => {
  it("trims, lowercases, drops blanks, and dedupes first-seen", () => {
    expect(normalizeTags(["Feature", "feature", "  ", "bugfix"])).toEqual([
      "feature",
      "bugfix",
    ]);
  });

  it("truncates over-length tags to MAX_TAG_LEN", () => {
    const long = "x".repeat(200);
    expect(normalizeTags([long])).toEqual(["x".repeat(MAX_TAG_LEN)]);
  });

  it("caps the list to MAX_TAGS entries", () => {
    const input = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    const out = normalizeTags(input);
    expect(out).toHaveLength(MAX_TAGS);
    expect(out[0]).toBe("tag0");
  });

  it("returns an empty array for all-blank input", () => {
    expect(normalizeTags(["", "   ", "\t"])).toEqual([]);
  });
});

describe("tagColor / fnv1a32", () => {
  it("returns the exact palette index for a known ASCII input", () => {
    // fnv1a32("feature") % 9 === 8 → slate
    expect(fnv1a32("feature") % TAG_PALETTE.length).toBe(8);
    expect(tagColor("feature")).toBe(TAG_PALETTE[8]);
  });

  it("hashes non-ASCII over UTF-8 bytes, not UTF-16 code units", () => {
    // UTF-8 byte source → index 7 (orange). A charCodeAt (UTF-16) hash would
    // give index 1 — this assertion is the guard against that regression.
    expect(fnv1a32("café") % TAG_PALETTE.length).toBe(7);
    expect(tagColor("café")).toBe(TAG_PALETTE[7]);
  });

  it("is deterministic and within palette bounds", () => {
    for (const tag of ["a", "backend", "docs", "very-long-tag-name-here"]) {
      const c = tagColor(tag);
      expect(TAG_PALETTE).toContain(c);
      expect(tagColor(tag)).toBe(c);
    }
  });
});
