/**
 * Streaming audio decode: any media file -> 16 kHz mono float32, decoded once
 * to a temp sibling and read back **on demand** per cue window. A 90-minute
 * recording is never held in memory as one buffer.
 *
 * The ffmpeg runner is injected so the cue-range -> PCM-window mapping is
 * testable without the native embedder, and the temp file is removed by
 * `close()` on both the success and failure paths.
 *
 * See change: add-speaker-id-enrollment.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Runner, ToolPathResolver } from "./ffmpeg.js";
import type { EmbedWindow } from "./speakerid.js";
import { l2 } from "./voiceprint.js";

export const TARGET_SAMPLE_RATE = 16000;
/** Windows shorter than this are dropped before embedding. */
export const MIN_WINDOW_SECONDS = 0.5;

export interface AudioSource {
  sampleRate: number;
  filePath: string;
  bytes: number;
  /** Read `[start, end)` seconds as mono float32; clamped to the file. */
  readWindow(start: number, end: number): Float32Array;
  /** Remove the decoded temp file. Safe to call more than once. */
  close(): void;
}

/** True when a window is too short or all-zero (silence is not embeddable). */
export function windowUsable(samples: Float32Array, sampleRate: number): boolean {
  if (samples.length < Math.floor(MIN_WINDOW_SECONDS * sampleRate)) return false;
  for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return true;
  return false;
}

function defaultTempPath(): string {
  return path.join(os.tmpdir(), `voiceid-${process.pid}-${randomBytes(6).toString("hex")}.f32`);
}

/**
 * Decode `mediaPath` to a temp f32le file via ffmpeg and return a lazy source.
 * The ffmpeg runner and binary resolver are injected; the source must be
 * `close()`d (use try/finally).
 */
export async function decodeAudio(
  mediaPath: string,
  run: Runner,
  resolve: ToolPathResolver,
  opts: { sampleRate?: number; output?: string } = {},
): Promise<AudioSource> {
  const sampleRate = opts.sampleRate ?? TARGET_SAMPLE_RATE;
  const ffmpeg = resolve("ffmpeg");
  if (!ffmpeg) throw new Error("ffmpeg is required to decode audio but was not found");
  const out = opts.output ?? defaultTempPath();

  const closed = { done: false };
  const close = () => {
    if (closed.done) return;
    closed.done = true;
    try {
      fs.rmSync(out, { force: true });
    } catch {
      // ignore cleanup failure
    }
  };

  try {
    await run(ffmpeg, [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-i",
      mediaPath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      out,
    ]);
  } catch (err) {
    close();
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffmpeg failed to decode ${mediaPath}: ${msg}`);
  }

  let bytes = 0;
  try {
    bytes = fs.statSync(out).size;
  } catch {
    close();
    throw new Error(`ffmpeg produced no audio for ${mediaPath}`);
  }
  if (bytes === 0) {
    close();
    throw new Error(`ffmpeg produced no audio for ${mediaPath}`);
  }

  const bytesPerSample = Float32Array.BYTES_PER_ELEMENT;
  return {
    sampleRate,
    filePath: out,
    bytes,
    readWindow(start: number, end: number): Float32Array {
      const from = Math.max(0, Math.floor(start * sampleRate)) * bytesPerSample;
      const to = Math.min(bytes, Math.max(0, Math.ceil(end * sampleRate)) * bytesPerSample);
      if (to <= from) return new Float32Array(0);
      const buf = Buffer.alloc(to - from);
      const fd = fs.openSync(out, "r");
      try {
        fs.readSync(fd, buf, 0, buf.length, from);
      } finally {
        fs.closeSync(fd);
      }
      return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / bytesPerSample));
    },
    close,
  };
}

/**
 * Build a speakerid `EmbedWindow` over a decoded source. Reads only the needed
 * window, skips short/silent windows, and L2-normalises the embedding.
 */
export function makeEmbedWindow(
  source: AudioSource,
  embed: (samples: Float32Array, sampleRate: number) => Float32Array | null,
): EmbedWindow {
  return (start: number, end: number) => {
    const samples = source.readWindow(start, end);
    if (!windowUsable(samples, source.sampleRate)) return null;
    const vector = embed(samples, source.sampleRate);
    return vector ? l2(vector) : null;
  };
}
