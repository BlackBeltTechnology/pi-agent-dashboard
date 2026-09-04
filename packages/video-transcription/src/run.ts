/**
 * Orchestration core shared by the bin and its smoke test. Wires config →
 * discover → (extract audio if video) → transcribeChunked → saveSrt, with a
 * per-file try/catch and a printed summary. Dependencies are injectable so the
 * bin uses real I/O while tests mock ffmpeg + the transcription backend.
 *
 * The backend set (`soniox` by default; `assemblyai` or `both` opt-in) comes
 * from `cfg.targets`. Each file is transcribed once per target and each target
 * writes its own sibling SRT, so `both` yields `.srt` + `.diarize.srt` from a
 * single audio extraction.
 */
import * as fs from "node:fs";
import { AssemblyAIClient } from "./assemblyai.js";
import { type TranscribeService, transcribeChunked } from "./chunk.js";
import { type BackendTarget, type Config, loadConfig } from "./config.js";
import { isTranscribed, isVideo, resolveInputs, saveSrt, srtPath } from "./discover.js";
import {
  extractAudio,
  extractedAudioPath,
  isFfmpegAvailable,
} from "./ffmpeg.js";
import { SonioxClient } from "./soniox.js";

/** Instantiate the transcription client for one resolved backend target. */
export function makeService(target: BackendTarget, cfg: Config): TranscribeService {
  if (target.backend === "assemblyai") {
    return new AssemblyAIClient({
      apiKey: target.apiKey,
      languageCode: cfg.languageCode,
      maxSpeakers: cfg.maxSpeakers,
    });
  }
  return new SonioxClient({ apiKey: target.apiKey });
}

/** True when every selected backend has already written its SRT for `file`. */
function isFullyTranscribed(file: string, cfg: Config): boolean {
  return cfg.targets.every((t) => isTranscribed(file, t.srtSuffix));
}

export interface RunDeps {
  loadConfig: () => Config;
  isFfmpegAvailable: () => Promise<boolean>;
  makeService: (target: BackendTarget, cfg: Config) => TranscribeService;
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

/**
 * Run `work(i)` for every `i` in `[0, size)` with at most `width` invocations in
 * flight. Workers claim indices from a shared cursor, so items are dispatched in
 * ascending order while their awaited work overlaps. Node's single thread makes
 * `cursor++` non-preemptible; interleaving only happens at `await` points.
 */
async function runPool(
  size: number,
  width: number,
  work: (index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= size) return;
      await work(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, size) }, () => worker()));
}

/**
 * Resolve the audio to transcribe: the file itself, or its extracted sibling
 * `.mp3` for a video. Extraction happens once per file even when several
 * backends will consume it. Returns `undefined` when a video cannot be handled
 * because ffmpeg is absent.
 */
async function resolveAudio(
  filepath: string,
  ffmpegOk: boolean,
  deps: RunDeps,
): Promise<string | undefined> {
  if (!isVideo(filepath)) return filepath;

  if (!ffmpegOk) {
    deps.warn(`  Skipping video file (no ffmpeg): ${filepath}`);
    return undefined;
  }

  const mp3Path = extractedAudioPath(filepath);
  if (fs.existsSync(mp3Path)) {
    deps.log(`  Audio already extracted: ${mp3Path}`);
  } else {
    deps.log("  Extracting audio...");
    await deps.extractAudio(filepath);
  }
  return mp3Path;
}

/**
 * Run one backend against already-resolved audio and write its sibling SRT.
 * Skips when that backend's SRT exists; a provider error is reported without
 * aborting the file's other backends.
 */
async function runTarget(
  filepath: string,
  audioPath: string,
  target: BackendTarget,
  service: TranscribeService | undefined,
  deps: RunDeps,
): Promise<FileOutcome> {
  const srt = srtPath(filepath, target.srtSuffix);
  if (isTranscribed(filepath, target.srtSuffix)) {
    deps.log(`  Already transcribed: ${srt}`);
    return "already";
  }
  if (!service) return "failed";

  try {
    deps.log(`  Transcribing via ${target.backend} API...`);
    const content = await deps.transcribe(service, audioPath, target.maxChunkSeconds);
    saveSrt(srt, content);
    deps.log(`  Saved: ${srt}`);
    return "transcribed";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.error(`Failed (${filepath} via ${target.backend}): ${msg}`);
    return "failed";
  }
}

/**
 * Process a single file: resolve its audio once, then run every selected
 * backend against it. The file's outcome is the best result across its targets
 * (any new SRT wins over a failure, which wins over an all-skipped file).
 */
async function processFile(
  filepath: string,
  services: Map<string, TranscribeService>,
  cfg: Config,
  ffmpegOk: boolean,
  deps: RunDeps,
): Promise<FileOutcome> {
  const audioPath = await resolveAudio(filepath, ffmpegOk, deps);
  if (audioPath === undefined) return "failed";

  const outcomes: FileOutcome[] = [];
  for (const target of cfg.targets) {
    outcomes.push(
      await runTarget(filepath, audioPath, target, services.get(target.backend), deps),
    );
  }

  if (outcomes.includes("transcribed")) return "transcribed";
  if (outcomes.includes("failed")) return "failed";
  return "already";
}

export const defaultDeps: RunDeps = {
  loadConfig: () => loadConfig(),
  isFfmpegAvailable: () => isFfmpegAvailable(),
  makeService: (target, cfg) => makeService(target, cfg),
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

  const toProcess = files.filter((f) => !isFullyTranscribed(f, cfg));
  let already = files.length - toProcess.length;
  const total = files.length;
  deps.log(`Found ${total} files: ${toProcess.length} to process, ${already} already transcribed`);

  if (toProcess.length === 0) {
    deps.log("Nothing to do.");
    return { total, already, newlyTranscribed: 0, failed: 0 };
  }

  const services = new Map(cfg.targets.map((t) => [t.backend, deps.makeService(t, cfg)]));
  let succeeded = 0;
  let failed = 0;

  // File-level worker pool: at most `cfg.concurrency` files in flight, dispatched
  // oldest-first so their provider waits overlap. Completion order is unordered.
  await runPool(toProcess.length, Math.max(cfg.concurrency, 1), async (i) => {
    const filepath = toProcess[i];
    deps.log(`Processing: ${filepath}`);
    try {
      const outcome = await processFile(filepath, services, cfg, ffmpegOk, deps);
      if (outcome === "transcribed") {
        succeeded += 1;
        deps.log(`Done: ${filepath}`);
      } else if (outcome === "already") {
        already += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.error(`Failed (${filepath}): ${msg}`);
      failed += 1;
    }
  });

  deps.log("");
  deps.log("=== Transcription Summary ===");
  deps.log(`  Total files found:      ${total}`);
  deps.log(`  Already transcribed:     ${already}`);
  deps.log(`  Newly transcribed:       ${succeeded}`);
  deps.log(`  Failed:                  ${failed}`);

  return { total, already, newlyTranscribed: succeeded, failed };
}
