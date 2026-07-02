import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractAudio,
  extractChunk,
  extractedAudioPath,
  getDurationSeconds,
  isFfmpegAvailable,
  type Runner,
} from "../ffmpeg.js";

const ok: Runner = async () => ({ stdout: "", stderr: "" });

describe("extractedAudioPath", () => {
  it("swaps the extension for .mp3", () => {
    expect(extractedAudioPath("/a/b/clip.mkv")).toBe("/a/b/clip.mp3");
    expect(extractedAudioPath("/a/b/clip.m4a")).toBe("/a/b/clip.mp3");
  });
});

describe("isFfmpegAvailable", () => {
  it("true when the runner succeeds", async () => {
    expect(await isFfmpegAvailable(ok)).toBe(true);
  });
  it("false when the runner throws", async () => {
    const run: Runner = async () => {
      throw new Error("not found");
    };
    expect(await isFfmpegAvailable(run)).toBe(false);
  });
});

describe("extractAudio", () => {
  it("passes the exact arg vector", async () => {
    const run = vi.fn(ok);
    const out = await extractAudio("/in/clip.mkv", {}, run);
    expect(out).toBe("/in/clip.mp3");
    expect(run).toHaveBeenCalledWith("ffmpeg", [
      "-i",
      "/in/clip.mkv",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      "-y",
      "/in/clip.mp3",
    ]);
  });

  it("adds -t when maxDurationSeconds is set", async () => {
    const run = vi.fn(ok);
    await extractAudio("/in/clip.mkv", { maxDurationSeconds: 60 }, run);
    expect(run.mock.calls[0][1]).toContain("-t");
    expect(run.mock.calls[0][1]).toContain("60");
  });

  it("cleans up partial output and throws on failure", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-ffmpeg-"));
    const output = path.join(dir, "out.mp3");
    fs.writeFileSync(output, "partial");
    const run: Runner = async () => {
      throw new Error("boom");
    };
    await expect(extractAudio("/in/clip.mkv", { output }, run)).rejects.toThrow(
      /FFmpeg extraction failed/,
    );
    expect(fs.existsSync(output)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("getDurationSeconds", () => {
  it("parses ffprobe output", async () => {
    const run: Runner = async () => ({ stdout: "123.45\n", stderr: "" });
    expect(await getDurationSeconds("/x.mp3", run)).toBeCloseTo(123.45);
  });
  it("returns 0 on unparseable output", async () => {
    const run: Runner = async () => ({ stdout: "N/A", stderr: "" });
    expect(await getDurationSeconds("/x.mp3", run)).toBe(0);
  });
  it("returns 0 when ffprobe throws", async () => {
    const run: Runner = async () => {
      throw new Error("no ffprobe");
    };
    expect(await getDurationSeconds("/x.mp3", run)).toBe(0);
  });
});

describe("extractChunk", () => {
  it("passes -ss/-t and re-encode args", async () => {
    const run = vi.fn(ok);
    await extractChunk("/in/clip.mp3", 100, 200, "/tmp/chunk.mp3", run);
    expect(run).toHaveBeenCalledWith("ffmpeg", [
      "-y",
      "-ss",
      "100",
      "-t",
      "200",
      "-i",
      "/in/clip.mp3",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      "/tmp/chunk.mp3",
    ]);
  });
});
