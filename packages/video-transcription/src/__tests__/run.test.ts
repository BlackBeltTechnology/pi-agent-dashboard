import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscribeService } from "../chunk.js";
import type { Config } from "../config.js";
import { extractedAudioPath } from "../ffmpeg.js";
import { type RunDeps, run } from "../run.js";

const cfg: Config = {
  apiKey: "k",
  maxChunkHours: 4.5,
  maxChunkSeconds: 16200,
  maxAudioMb: 200,
  concurrency: 8,
};

/** Build deps whose loadConfig reports a specific pool width. */
function depsWithConcurrency(concurrency: number, over: Partial<RunDeps> = {}): RunDeps {
  return makeDeps({ loadConfig: () => ({ ...cfg, concurrency }), ...over });
}

/** Create `names` audio files with strictly increasing mtimes (oldest-first). */
function seedAudio(dir: string, names: string[]): string[] {
  return names.map((name, i) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, "x");
    const t = new Date(Date.now() + i * 1000);
    fs.utimesSync(p, t, t);
    return p;
  });
}
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

  it("produces identical totals at concurrency 4 and concurrency 1", async () => {
    const names = ["a", "b", "c", "d", "e", "f"].map((n) => `${n}.m4a`);

    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "vt-run-serial-"));
    seedAudio(dir1, names);
    const serial = await run([dir1], depsWithConcurrency(1));

    const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), "vt-run-par-"));
    seedAudio(dir4, names);
    const parallel = await run([dir4], depsWithConcurrency(4));

    expect(parallel).toEqual(serial);
    expect(parallel).toMatchObject({ total: 6, newlyTranscribed: 6, failed: 0 });

    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir4, { recursive: true, force: true });
  });

  it("runs up to `concurrency` files in flight, never more", async () => {
    seedAudio(dir, ["a", "b", "c", "d", "e", "f"].map((n) => `${n}.m4a`));
    let inFlight = 0;
    let peak = 0;
    const transcribe = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return fakeSrt;
    });
    const summary = await run([dir], depsWithConcurrency(4, { transcribe }));
    expect(summary.newlyTranscribed).toBe(6);
    expect(peak).toBe(4); // min(concurrency, fileCount) reached, and never exceeded
  });

  it("isolates a single failing file within the pool", async () => {
    seedAudio(dir, ["a", "b", "c"].map((n) => `${n}.m4a`));
    const transcribe = vi.fn(async (_s: unknown, audioPath: string) => {
      if (audioPath.endsWith("b.m4a")) throw new Error("api down");
      return fakeSrt;
    });
    const summary = await run([dir], depsWithConcurrency(4, { transcribe }));
    expect(summary).toMatchObject({ total: 3, newlyTranscribed: 2, failed: 1 });
    expect(fs.existsSync(path.join(dir, "a.srt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "c.srt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "b.srt"))).toBe(false);
  });

  it("preserves oldest-first completion order at concurrency 1", async () => {
    seedAudio(dir, ["a", "b", "c", "d"].map((n) => `${n}.m4a`));
    const order: string[] = [];
    const transcribe = vi.fn(async (_s: unknown, audioPath: string) => {
      order.push(path.basename(audioPath));
      return fakeSrt;
    });
    await run([dir], depsWithConcurrency(1, { transcribe }));
    expect(order).toEqual(["a.m4a", "b.m4a", "c.m4a", "d.m4a"]);
  });
});
