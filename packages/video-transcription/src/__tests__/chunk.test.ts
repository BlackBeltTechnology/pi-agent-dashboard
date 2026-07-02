import { describe, expect, it, vi } from "vitest";
import {
  shiftAndRenumberSrt,
  type TranscribeService,
  transcribeChunked,
} from "../chunk.js";
import type { Runner } from "../ffmpeg.js";

const srt1 = ["1", "00:00:00,000 --> 00:00:01,000", "[Speaker 1] a", ""].join("\n");
const srt2 = ["1", "00:00:02,000 --> 00:00:03,000", "[Speaker 1] b", ""].join("\n");

describe("shiftAndRenumberSrt", () => {
  it("shifts timestamps and renumbers from startIdx", () => {
    const [text, next] = shiftAndRenumberSrt(srt1, 60000, 5);
    expect(text).toContain("5");
    expect(text).toContain("00:01:00,000 --> 00:01:01,000");
    expect(next).toBe(6);
  });

  it("renumbers a multi-cue block sequentially", () => {
    const block = [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "[Speaker 1] a",
      "",
      "2",
      "00:00:01,000 --> 00:00:02,000",
      "[Speaker 2] b",
    ].join("\n");
    const [text, next] = shiftAndRenumberSrt(block, 0, 1);
    expect(next).toBe(3);
    expect(text.split("\n\n")).toHaveLength(2);
  });
});

describe("transcribeChunked", () => {
  it("sub-limit path calls transcribeFile once with the original path", async () => {
    const service: TranscribeService = { transcribeFile: vi.fn(async () => srt1) };
    const durationRunner: Runner = async () => ({ stdout: "100", stderr: "" });
    const out = await transcribeChunked(service, "/in/clip.mp3", {
      chunkSeconds: 1000,
      durationRunner,
    });
    expect(service.transcribeFile).toHaveBeenCalledTimes(1);
    expect(service.transcribeFile).toHaveBeenCalledWith("/in/clip.mp3");
    expect(out).toBe(srt1);
  });

  it("throws on non-positive chunkSeconds (guards against an infinite loop)", async () => {
    const service: TranscribeService = { transcribeFile: vi.fn(async () => srt1) };
    await expect(
      transcribeChunked(service, "/in/clip.mp3", { chunkSeconds: 0 }),
    ).rejects.toThrow(/positive/);
    expect(service.transcribeFile).not.toHaveBeenCalled();
  });

  it("zero duration falls back to a single request", async () => {
    const service: TranscribeService = { transcribeFile: vi.fn(async () => srt1) };
    const durationRunner: Runner = async () => ({ stdout: "N/A", stderr: "" });
    await transcribeChunked(service, "/in/clip.mp3", { chunkSeconds: 10, durationRunner });
    expect(service.transcribeFile).toHaveBeenCalledTimes(1);
    expect(service.transcribeFile).toHaveBeenCalledWith("/in/clip.mp3");
  });

  it("over-limit path splits, merges, and produces monotonic timestamps + sequential indices", async () => {
    // duration 2500s, chunkSeconds 1000 => 3 chunks (0, 1000, 2000).
    const durationRunner: Runner = async () => ({ stdout: "2500", stderr: "" });
    const chunkRunner: Runner = async () => ({ stdout: "", stderr: "" });
    const service: TranscribeService = {
      // Each chunk yields two cues at 0-1s and 2-3s (relative).
      transcribeFile: vi.fn(async () => `${srt1}\n${srt2}`),
    };
    const out = await transcribeChunked(service, "/in/clip.mp3", {
      chunkSeconds: 1000,
      durationRunner,
      chunkRunner,
    });
    expect(service.transcribeFile).toHaveBeenCalledTimes(3);

    // Extract cue indices and start times.
    const indices = [...out.matchAll(/^(\d+)$/gm)].map((m) => Number(m[1]));
    expect(indices).toEqual([1, 2, 3, 4, 5, 6]);

    const starts = [...out.matchAll(/(\d{2}):(\d{2}):(\d{2}),(\d{3}) -->/g)].map(
      (m) => ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]),
    );
    // Chunk offsets 0s,1000s,2000s each with cues at 0s and 2s.
    expect(starts).toEqual([0, 2000, 1_000_000, 1_002_000, 2_000_000, 2_002_000]);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
  });
});
