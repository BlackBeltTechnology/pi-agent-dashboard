import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscribeService } from "../chunk.js";
import type { Config } from "../config.js";
import { extractedAudioPath } from "../ffmpeg.js";
import { type RunDeps, run } from "../run.js";

const cfg: Config = { apiKey: "k", maxChunkHours: 4.5, maxChunkSeconds: 16200, maxAudioMb: 200 };
const fakeSrt = "1\n00:00:00,000 --> 00:00:01,000\n[Speaker 1] hi\n";

function makeDeps(over: Partial<RunDeps> = {}): RunDeps {
  const service: TranscribeService = { transcribeFile: vi.fn(async () => fakeSrt) };
  return {
    loadConfig: () => cfg,
    isFfmpegAvailable: async () => true,
    makeService: () => service,
    extractAudio: vi.fn(async (src: string) => {
      const out = extractedAudioPath(src);
      fs.writeFileSync(out, "audio");
      return out;
    }),
    transcribe: vi.fn(async () => fakeSrt),
    log: () => {},
    warn: () => {},
    error: () => {},
    ...over,
  };
}

describe("run (smoke)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-run-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("transcribes audio files and writes sibling SRTs", async () => {
    const a = path.join(dir, "a.m4a");
    fs.writeFileSync(a, "x");
    const deps = makeDeps();
    const summary = await run([dir], deps);
    expect(summary).toMatchObject({ total: 1, newlyTranscribed: 1, failed: 0 });
    expect(fs.readFileSync(path.join(dir, "a.srt"), "utf8")).toBe(fakeSrt);
  });

  it("extracts audio for video files before transcribing", async () => {
    const v = path.join(dir, "v.mp4");
    fs.writeFileSync(v, "x");
    const deps = makeDeps();
    const summary = await run([dir], deps);
    expect(deps.extractAudio).toHaveBeenCalledWith(v);
    // Transcribe is called against the extracted mp3.
    expect(deps.transcribe).toHaveBeenCalledWith(expect.anything(), path.join(dir, "v.mp3"), 16200);
    expect(fs.existsSync(path.join(dir, "v.srt"))).toBe(true);
    expect(summary.newlyTranscribed).toBe(1);
  });

  it("skips video files when ffmpeg is absent but still processes audio", async () => {
    fs.writeFileSync(path.join(dir, "v.mp4"), "x");
    fs.writeFileSync(path.join(dir, "a.m4a"), "x");
    const deps = makeDeps({ isFfmpegAvailable: async () => false });
    const summary = await run([dir], deps);
    expect(summary.total).toBe(2);
    expect(summary.newlyTranscribed).toBe(1); // audio only
    expect(summary.failed).toBe(1); // video skipped
    expect(fs.existsSync(path.join(dir, "a.srt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "v.srt"))).toBe(false);
  });

  it("skips already-transcribed files", async () => {
    const a = path.join(dir, "a.m4a");
    fs.writeFileSync(a, "x");
    fs.writeFileSync(path.join(dir, "a.srt"), "existing");
    const deps = makeDeps();
    const summary = await run([dir], deps);
    expect(summary).toMatchObject({ total: 1, already: 1, newlyTranscribed: 0 });
    expect(deps.transcribe).not.toHaveBeenCalled();
  });

  it("reports per-file failures without aborting", async () => {
    fs.writeFileSync(path.join(dir, "a.m4a"), "x");
    fs.writeFileSync(path.join(dir, "b.m4a"), "x");
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("api down"))
      .mockResolvedValueOnce(fakeSrt);
    const summary = await run([dir], makeDeps({ transcribe }));
    expect(summary.total).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.newlyTranscribed).toBe(1);
  });

  it("returns an empty summary when no files are found", async () => {
    const summary = await run([dir], makeDeps());
    expect(summary).toEqual({ total: 0, already: 0, newlyTranscribed: 0, failed: 0 });
  });
});
