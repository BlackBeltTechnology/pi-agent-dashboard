/**
 * Orchestration core shared by the bin and its smoke test. Wires config →
 * discover → (extract audio if video) → transcribeChunked → saveSrt, with a
 * per-file try/catch and a printed summary. Dependencies are injectable so the
 * bin uses real I/O while tests mock ffmpeg + Soniox.
 */
import * as fs from "node:fs";
import { type TranscribeService, transcribeChunked } from "./chunk.js";
import { type Config, loadConfig } from "./config.js";
import { isTranscribed, isVideo, resolveInputs, saveSrt, srtPath } from "./discover.js";
import {
  extractAudio,
  extractedAudioPath,
  isFfmpegAvailable,
} from "./ffmpeg.js";
import { SonioxClient } from "./soniox.js";

export interface RunDeps {
  loadConfig: () => Config;
  isFfmpegAvailable: () => Promise<boolean>;
  makeService: (cfg: Config) => TranscribeService;
  extractAudio: (src: string) => Promise<string>;
  transcribe: (service: TranscribeService, audioPath: string, chunkSeconds: number) => Promise<string>;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface RunSummary {
  total: number;
  already: number;
  newlyTranscribed: number;
  failed: number;
}

type FileOutcome = "transcribed" | "already" | "failed";

/** Process a single file: extract audio if video, transcribe, save SRT. */
async function processFile(
  filepath: string,
  service: TranscribeService,
  cfg: Config,
  ffmpegOk: boolean,
  deps: RunDeps,
): Promise<FileOutcome> {
  let audioPath = filepath;

  if (isVideo(filepath)) {
    if (!ffmpegOk) {
      deps.warn(`  Skipping video file (no ffmpeg): ${filepath}`);
      return "failed";
    }
    const mp3Path = extractedAudioPath(filepath);
    if (fs.existsSync(mp3Path)) {
      deps.log(`  Audio already extracted: ${mp3Path}`);
    } else {
      deps.log("  Extracting audio...");
      await deps.extractAudio(filepath);
    }
    audioPath = mp3Path;
  }

  const srt = srtPath(filepath);
  if (isTranscribed(filepath)) {
    deps.log(`  Already transcribed: ${srt}`);
    return "already";
  }

  deps.log("  Transcribing via Soniox API...");
  const content = await deps.transcribe(service, audioPath, cfg.maxChunkSeconds);
  saveSrt(srt, content);
  deps.log(`  Saved: ${srt}`);
  return "transcribed";
}

export const defaultDeps: RunDeps = {
  loadConfig: () => loadConfig(),
  isFfmpegAvailable: () => isFfmpegAvailable(),
  makeService: (cfg) => new SonioxClient({ apiKey: cfg.apiKey }),
  extractAudio: (src) => extractAudio(src),
  transcribe: (service, audioPath, chunkSeconds) =>
    transcribeChunked(service, audioPath, { chunkSeconds }),
  log: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export async function run(args: string[], deps: RunDeps = defaultDeps): Promise<RunSummary> {
  const cfg = deps.loadConfig();
  const ffmpegOk = await deps.isFfmpegAvailable();
  if (!ffmpegOk) {
    deps.warn(
      "ffmpeg not found - video files will be skipped (audio-only files will still be processed)",
    );
  }

  const files = resolveInputs(args);
  if (files.length === 0) {
    deps.log("No audio/video files found.");
    return { total: 0, already: 0, newlyTranscribed: 0, failed: 0 };
  }

  const toProcess = files.filter((f) => !isTranscribed(f));
  let already = files.length - toProcess.length;
  const total = files.length;
  deps.log(`Found ${total} files: ${toProcess.length} to process, ${already} already transcribed`);

  if (toProcess.length === 0) {
    deps.log("Nothing to do.");
    return { total, already, newlyTranscribed: 0, failed: 0 };
  }

  const service = deps.makeService(cfg);
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const filepath = toProcess[i];
    deps.log(`[${i + 1}/${toProcess.length}] Processing: ${filepath}`);
    try {
      const outcome = await processFile(filepath, service, cfg, ffmpegOk, deps);
      if (outcome === "transcribed") succeeded += 1;
      else if (outcome === "already") already += 1;
      else failed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.error(`  Failed: ${msg}`);
      failed += 1;
    }
  }

  deps.log("");
  deps.log("=== Transcription Summary ===");
  deps.log(`  Total files found:      ${total}`);
  deps.log(`  Already transcribed:     ${already}`);
  deps.log(`  Newly transcribed:       ${succeeded}`);
  deps.log(`  Failed:                  ${failed}`);

  return { total, already, newlyTranscribed: succeeded, failed };
}
