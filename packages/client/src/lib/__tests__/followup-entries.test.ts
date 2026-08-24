/**
 * Tolerant read of `pendingQueues.followUp` at the client boundary (design D2b).
 *
 * A browser tab left open across an extension reload receives the PRE-change
 * `string[]` shape; without this normaliser every chip renders `[object Object]`.
 *
 * Covers test-plan row F4.
 *
 * See change: fix-bridge-followup-image-drop.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeFollowUpEntries,
  normalizeFollowUpEntry,
} from "../chat/followup-entries.js";

describe("normalizeFollowUpEntry", () => {
  it("lifts a legacy string entry into the current shape (F4)", () => {
    expect(normalizeFollowUpEntry("hello")).toEqual({ text: "hello", imageCount: 0 });
  });

  it("passes a current entry through unchanged", () => {
    expect(normalizeFollowUpEntry({ text: "describe", imageCount: 2 })).toEqual({
      text: "describe",
      imageCount: 2,
    });
  });

  it("never yields a non-string text, so no chip can render [object Object] (F4)", () => {
    for (const junk of [null, undefined, 42, { imageCount: 3 }, { text: { nested: true } }]) {
      const normalised = normalizeFollowUpEntry(junk);
      expect(typeof normalised.text).toBe("string");
      expect(normalised.text).not.toContain("[object Object]");
    }
  });

  it("floors a missing or nonsensical imageCount at zero", () => {
    expect(normalizeFollowUpEntry({ text: "a" }).imageCount).toBe(0);
    expect(normalizeFollowUpEntry({ text: "a", imageCount: -3 }).imageCount).toBe(0);
    expect(normalizeFollowUpEntry({ text: "a", imageCount: "2" }).imageCount).toBe(0);
  });

  it("rejects a fractional or infinite count, which would render as \"1.5\" on a chip", () => {
    expect(normalizeFollowUpEntry({ text: "a", imageCount: 1.5 }).imageCount).toBe(0);
    expect(normalizeFollowUpEntry({ text: "a", imageCount: Number.POSITIVE_INFINITY }).imageCount).toBe(0);
    expect(normalizeFollowUpEntry({ text: "a", imageCount: Number.NaN }).imageCount).toBe(0);
  });
});

describe("normalizeFollowUpEntries", () => {
  it("normalises a whole legacy array (F4)", () => {
    expect(normalizeFollowUpEntries(["hello", "world"])).toEqual([
      { text: "hello", imageCount: 0 },
      { text: "world", imageCount: 0 },
    ]);
  });

  it("normalises a MIXED array — the exact skew window D2b covers", () => {
    expect(normalizeFollowUpEntries(["legacy", { text: "current", imageCount: 1 }])).toEqual([
      { text: "legacy", imageCount: 0 },
      { text: "current", imageCount: 1 },
    ]);
  });

  it("yields an empty array for a missing or non-array queue", () => {
    expect(normalizeFollowUpEntries(undefined)).toEqual([]);
    expect(normalizeFollowUpEntries(null)).toEqual([]);
    expect(normalizeFollowUpEntries("nope")).toEqual([]);
  });
});
