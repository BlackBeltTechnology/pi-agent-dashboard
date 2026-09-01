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
  type ToolPathResolver,
} from "../ffmpeg.js";

const ok: Runner = async () => ({ stdout: "", stderr: "" });

/** Pre-registry behavior: resolve to the bare name (PATH spawn). */
const bareName: ToolPathResolver = (n) => n;

describe("extractedAudioPath", () => {
  it("swaps the extension for .mp3", () => {
    expect(extractedAudioPath("/a/b/clip.mkv")).toBe("/a/b/clip.mp3");
    expect(extractedAudioPath("/a/b/clip.m4a")).toBe("/a/b/clip.mp3");
  });
});

describe("isFfmpegAvailable", () => {
  it("true when the runner succeeds", async () => {
    expect(await isFfmpegAvailable(ok, bareName)).toBe(true);
  });
  it("false when the runner throws", async () => {
    const run: Runner = async () => {
      throw new Error("not found");
    };
    expect(await isFfmpegAvailable(run, bareName)).toBe(false);
  });
});

describe("extractAudio", () => {
  it("passes the exact arg vector", async () => {
    const run = vi.fn(ok);
    const out = await extractAudio("/in/clip.mkv", {}, run, bareName);
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
    await extractAudio("/in/clip.mkv", { maxDurationSeconds: 60 }, run, bareName);
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
    await expect(extractAudio("/in/clip.mkv", { output }, run, bareName)).rejects.toThrow(
      /FFmpeg extraction failed/,
    );
    expect(fs.existsSync(output)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("getDurationSeconds", () => {
  it("parses ffprobe output", async () => {
    const run: Runner = async () => ({ stdout: "123.45\n", stderr: "" });
    expect(await getDurationSeconds("/x.mp3", run, bareName)).toBeCloseTo(123.45);
  });
  it("returns 0 on unparseable output", async () => {
    const run: Runner = async () => ({ stdout: "N/A", stderr: "" });
    expect(await getDurationSeconds("/x.mp3", run, bareName)).toBe(0);
  });
  it("returns 0 when ffprobe throws", async () => {
    const run: Runner = async () => {
      throw new Error("no ffprobe");
    };
    expect(await getDurationSeconds("/x.mp3", run, bareName)).toBe(0);
  });
});

describe("extractChunk", () => {
  it("passes -ss/-t and re-encode args", async () => {
    const run = vi.fn(ok);
    await extractChunk("/in/clip.mp3", 100, 200, "/tmp/chunk.mp3", run, bareName);
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

describe("registry routing (tool-registry resolve seam)", () => {
  // The wrappers resolve binaries through the shared ToolRegistry so an
  // ffmpeg delivered via ffmpeg-static (static-npm strategy) is usable.
  // See change: add-skill-tool-provisioning (design D3, task 4.1).
  const staticFfmpeg = () => "/opt/ffmpeg-static/ffmpeg";

  it("isFfmpegAvailable runs the RESOLVED path, not the bare name", async () => {
    const seen: string[] = [];
    const run: Runner = async (file) => {
      seen.push(file);
      return { stdout: "", stderr: "" };
    };
    expect(await isFfmpegAvailable(run, staticFfmpeg)).toBe(true);
    expect(seen).toEqual(["/opt/ffmpeg-static/ffmpeg"]);
  });

  it("isFfmpegAvailable degrades to false when the resolver misses — never runs", async () => {
    const run = vi.fn(ok);
    expect(await isFfmpegAvailable(run, () => null)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("getDurationSeconds runs the resolved ffprobe; 0 on miss", async () => {
    const seen: string[] = [];
    const run: Runner = async (file) => {
      seen.push(file);
      return { stdout: "7.5\n", stderr: "" };
    };
    expect(await getDurationSeconds("/x.mp3", run, () => "/opt/ffprobe")).toBeCloseTo(7.5);
    expect(seen).toEqual(["/opt/ffprobe"]);
    const run2 = vi.fn(ok);
    expect(await getDurationSeconds("/x.mp3", run2, () => null)).toBe(0);
    expect(run2).not.toHaveBeenCalled();
  });

  it("extractAudio runs the resolved ffmpeg path", async () => {
    const run = vi.fn(ok);
    await extractAudio("/in/clip.mkv", {}, run, staticFfmpeg);
    expect(run.mock.calls[0][0]).toBe("/opt/ffmpeg-static/ffmpeg");
  });

  it("extractChunk throws a helpful error when the resolver misses", async () => {
    const run = vi.fn(ok);
    await expect(extractChunk("/in/x.mp3", 0, 1, "/tmp/o.mp3", run, () => null)).rejects.toThrow(
      /ffmpeg/i,
    );
    expect(run).not.toHaveBeenCalled();
  });
});
