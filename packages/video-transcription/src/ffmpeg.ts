/**
 * ffmpeg/ffprobe wrappers via `execFile`. External binaries, not npm deps.
 * Availability is probed; extraction cleans up partial output on failure.
 */

import * as fs from "node:fs";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";

export interface ExtractAudioOptions {
  maxDurationSeconds?: number;
  output?: string;
}

/** Injected in tests. Runs a binary and resolves stdout. */
export type Runner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

/**
 * Resolves a tool name to a spawnable path via the shared ToolRegistry —
 * so an ffmpeg delivered by `ffmpeg-static` (static-npm strategy) is
 * usable, not just one on PATH. Null = absent. Injectable in tests.
 *
 * See change: add-skill-tool-provisioning (design D3, task 4.1).
 */
export type ToolPathResolver = (name: string) => string | null;

const registryResolver: ToolPathResolver = (name) => {
  try {
    const r = getDefaultRegistry().resolve(name);
    return r.ok && r.path ? r.path : null;
  } catch {
    return null; // UnknownToolError → absent
  }
};

const defaultRunner: Runner = async (file, args) => {
  // Wrapped execFile applies windowsHide:true; coerce to string for the Runner
  // contract (default utf8 encoding already yields strings).
  const { stdout, stderr } = await execFileAsync(file, args);
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** Return the sibling `.mp3` path for a media file. */
export function extractedAudioPath(mediaPath: string): string {
  return `${mediaPath.replace(/\.[^./\\]+$/, "")}.mp3`;
}

/** True when `ffmpeg` resolves and runs (`-version`). Gates video processing. */
export async function isFfmpegAvailable(
  run: Runner = defaultRunner,
  resolve: ToolPathResolver = registryResolver,
): Promise<boolean> {
  const ffmpeg = resolve("ffmpeg");
  if (!ffmpeg) return false;
  try {
    await run(ffmpeg, ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract audio from a video/audio file to MP3
 * (`-vn -acodec libmp3lame -q:a 2`). Cleans up partial output on failure.
 */
export async function extractAudio(
  src: string,
  opts: ExtractAudioOptions = {},
  run: Runner = defaultRunner,
  resolve: ToolPathResolver = registryResolver,
): Promise<string> {
  const ffmpeg = resolve("ffmpeg");
  if (!ffmpeg) {
    throw new Error("FFmpeg extraction failed: ffmpeg not available (see registry installHints)");
  }
  const output = opts.output ?? extractedAudioPath(src);
  const args = ["-i", src, "-vn", "-acodec", "libmp3lame", "-q:a", "2"];
  if (opts.maxDurationSeconds && opts.maxDurationSeconds > 0) {
    args.push("-t", String(opts.maxDurationSeconds));
  }
  args.push("-y", output);

  try {
    await run(ffmpeg, args);
    return output;
  } catch (err) {
    try {
      fs.rmSync(output, { force: true });
    } catch {
      // ignore cleanup failure
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`FFmpeg extraction failed: ${msg}`);
  }
}

/** Probe media duration in seconds via `ffprobe`; 0 on parse failure. */
export async function getDurationSeconds(
  mediaPath: string,
  run: Runner = defaultRunner,
  resolve: ToolPathResolver = registryResolver,
): Promise<number> {
  const ffprobe = resolve("ffprobe");
  if (!ffprobe) return 0;
  try {
    const { stdout } = await run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      mediaPath,
    ]);
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Re-encode a `[startS, startS+lengthS)` slice to MP3 (`-ss -t`). */
export async function extractChunk(
  src: string,
  startS: number,
  lengthS: number,
  dest: string,
  run: Runner = defaultRunner,
  resolve: ToolPathResolver = registryResolver,
): Promise<void> {
  const ffmpeg = resolve("ffmpeg");
  if (!ffmpeg) {
    throw new Error("ffmpeg not available (see registry installHints)");
  }
  await run(ffmpeg, [
    "-y",
    "-ss",
    String(startS),
    "-t",
    String(lengthS),
    "-i",
    src,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "2",
    dest,
  ]);
}
