import { describe, expect, it } from "vitest";
import { formatTimestamp, groupTokens, type Token, tokensToSrt } from "../srt.js";

describe("formatTimestamp", () => {
  it("formats zero", () => {
    expect(formatTimestamp(0)).toBe("00:00:00,000");
  });
  it("formats hours/minutes/seconds/millis", () => {
    expect(formatTimestamp(3_661_234)).toBe("01:01:01,234");
  });
  it("pads millis to three digits", () => {
    expect(formatTimestamp(5)).toBe("00:00:00,005");
  });
});

describe("groupTokens", () => {
  it("returns empty for no tokens", () => {
    expect(groupTokens([])).toEqual([]);
  });

  it("merges same-speaker tokens within the time window", () => {
    const tokens: Token[] = [
      { text: "Hello", speaker: "Speaker 1", start_ms: 0, end_ms: 500 },
      { text: " world", speaker: "Speaker 1", start_ms: 500, end_ms: 1000 },
    ];
    const segs = groupTokens(tokens);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("Hello world");
    expect(segs[0].end_ms).toBe(1000);
  });

  it("breaks on speaker change", () => {
    const tokens: Token[] = [
      { text: "Hi", speaker: "Speaker 1", start_ms: 0, end_ms: 500 },
      { text: "Yo", speaker: "Speaker 2", start_ms: 600, end_ms: 900 },
    ];
    const segs = groupTokens(tokens);
    expect(segs).toHaveLength(2);
    expect(segs[1].speaker).toBe("Speaker 2");
  });

  it("breaks once a segment spans maxSegmentMs (5000)", () => {
    const tokens: Token[] = [
      { text: "a", speaker: "Speaker 1", start_ms: 0, end_ms: 100 },
      { text: "b", speaker: "Speaker 1", start_ms: 5000, end_ms: 5100 },
    ];
    const segs = groupTokens(tokens);
    expect(segs).toHaveLength(2);
  });

  it("skips blank-text tokens", () => {
    const tokens: Token[] = [
      { text: "  ", speaker: "Speaker 1", start_ms: 0, end_ms: 100 },
      { text: "x", speaker: "Speaker 1", start_ms: 100, end_ms: 200 },
    ];
    const segs = groupTokens(tokens);
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("x");
  });

  it("defaults missing speaker to Speaker 1", () => {
    const segs = groupTokens([{ text: "hi", start_ms: 0, end_ms: 100 }]);
    expect(segs[0].speaker).toBe("Speaker 1");
  });
});

describe("tokensToSrt (golden)", () => {
  it("returns empty string for no tokens", () => {
    expect(tokensToSrt({ tokens: [] })).toBe("");
    expect(tokensToSrt({})).toBe("");
  });

  it("produces byte-identical SRT to the Python output", () => {
    const tokens: Token[] = [
      { text: "Hello", speaker: "Speaker 1", start_ms: 0, end_ms: 500 },
      { text: " there", speaker: "Speaker 1", start_ms: 500, end_ms: 1000 },
      { text: "Hi", speaker: "Speaker 2", start_ms: 1200, end_ms: 1600 },
    ];
    const expected = [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "[Speaker 1] Hello there",
      "",
      "2",
      "00:00:01,200 --> 00:00:01,600",
      "[Speaker 2] Hi",
      "",
    ].join("\n");
    expect(tokensToSrt({ tokens })).toBe(expected);
  });
});
