import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeAudio,
  MIN_WINDOW_SECONDS,
  makeEmbedWindow,
  TARGET_SAMPLE_RATE,
  windowUsable,
} from "../audio-decode.js";
import type { Runner } from "../ffmpeg.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ad-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A runner that writes `samples` to the final arg (the temp output path). */
function writingRunner(samples: Float32Array): Runner {
  return async (_file, args) => {
    const out = args[args.length - 1];
    fs.writeFileSync(out, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    return { stdout: "", stderr: "" };
  };
}

describe("decodeAudio", () => {
  it("decodes to 16 kHz mono float32 and reads windows on demand", async () => {
    const sr = TARGET_SAMPLE_RATE;
    const samples = Float32Array.from({ length: sr * 3 }, (_, i) => Math.sin(i / 10));
    const out = path.join(tmp(), "audio.f32");
    const source = await decodeAudio("/media/in.mp4", writingRunner(samples), () => "ffmpeg", { output: out });
    expect(source.sampleRate).toBe(sr);
    expect(source.bytes).toBe(samples.byteLength);
    const window = source.readWindow(1, 2);
    expect(window.length).toBe(sr);
    expect(window[0]).toBeCloseTo(samples[sr], 5);
    source.close();
    expect(fs.existsSync(out)).toBe(false);
  });

  it("X20 cleans up the temp file when decode fails", async () => {
    const out = path.join(tmp(), "audio.f32");
    const failing: Runner = async () => {
      throw new Error("boom");
    };
    await expect(
      decodeAudio("/media/in.mp4", failing, () => "ffmpeg", { output: out }),
    ).rejects.toThrow(/ffmpeg failed to decode/);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(`${out}.partial`)).toBe(false);
  });

  it("throws when ffmpeg is unavailable", async () => {
    await expect(decodeAudio("/media/in.mp4", writingRunner(new Float32Array(1)), () => null)).rejects.toThrow(
      /ffmpeg/,
    );
  });
});

describe("window usability", () => {
  it("X21 skips short windows and pure silence", () => {
    const sr = 16000;
    expect(windowUsable(new Float32Array(Math.floor(MIN_WINDOW_SECONDS * sr) - 1).fill(0.1), sr)).toBe(false);
    expect(windowUsable(new Float32Array(sr).fill(0), sr)).toBe(false);
    expect(windowUsable(new Float32Array(sr).fill(0.01), sr)).toBe(true);
  });
});

describe("makeEmbedWindow", () => {
  it("normalises and passes only usable windows to the embedder", async () => {
    const sr = TARGET_SAMPLE_RATE;
    const samples = Float32Array.from({ length: sr * 4 }, () => 0.5);
    const source = await decodeAudio("/media/in.mp4", writingRunner(samples), () => "ffmpeg", {
      output: path.join(tmp(), "audio.f32"),
    });
    const embed = vi.fn((_s: Float32Array) => Float32Array.from([3, 4]));
    const embedWindow = makeEmbedWindow(source, embed);
    const v = embedWindow(0, 2)!;
    expect(embed).toHaveBeenCalledTimes(1);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
    // a sub-minimum window never reaches the embedder
    expect(embedWindow(0, 0.2)).toBeNull();
    expect(embed).toHaveBeenCalledTimes(1);
    source.close();
  });
});
