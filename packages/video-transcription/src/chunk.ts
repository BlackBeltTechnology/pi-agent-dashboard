/**
 * Long-recording chunking. Soniox enforces a hard per-request duration limit
 * (18000 s / 5 h). Recordings over the limit split into `chunkSeconds` pieces,
 * transcribe independently, and merge with absolute timestamps — no truncation.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { extractChunk, getDurationSeconds, type Runner } from "./ffmpeg.js";

/** 4.5 h default; safely under the 5 h Soniox limit to absorb re-encode drift. */
export const DEFAULT_CHUNK_SECONDS = 16200;

const TS_RE =
  /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

function msToTs(msInput: number): string {
  let ms = msInput;
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

function parseTs(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
}

/**
 * Shift every timestamp in an SRT block by `offsetMs` and renumber cue indices
 * sequentially from `startIdx`. Returns `[shiftedText, nextIndex]`.
 */
export function shiftAndRenumberSrt(
  srt: string,
  offsetMs: number,
  startIdx: number,
): [string, number] {
  const blocks = srt
    .trim()
    .split("\n\n")
    .filter((b) => b.trim());
  const out: string[] = [];
  let idx = startIdx;

  for (const block of blocks) {
    const lines = block.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = TS_RE.exec(lines[i].trim());
      if (!m) continue;
      const start = parseTs(m[1], m[2], m[3], m[4]) + offsetMs;
      const end = parseTs(m[5], m[6], m[7], m[8]) + offsetMs;
      lines[i] = `${msToTs(start)} --> ${msToTs(end)}`;
      lines[0] = String(idx);
      idx += 1;
      out.push(lines.join("\n"));
      break;
    }
  }

  return [out.join("\n\n"), idx];
}

export interface TranscribeService {
  transcribeFile(audioFile: string): Promise<string>;
}

export interface TranscribeChunkedOptions {
  chunkSeconds?: number;
  /** Injected in tests. Defaults to real ffprobe. */
  durationRunner?: Runner;
  /** Injected in tests. Defaults to real ffmpeg. */
  chunkRunner?: Runner;
}

/**
 * Transcribe an audio file of any length. Single request when at/under the
 * limit; otherwise split into `chunkSeconds` pieces, transcribe each, and merge
 * the SRT with absolute offsets. Uses a temp dir with guaranteed cleanup.
 */
export async function transcribeChunked(
  service: TranscribeService,
  audioPath: string,
  opts: TranscribeChunkedOptions = {},
): Promise<string> {
  const chunkSeconds = opts.chunkSeconds ?? DEFAULT_CHUNK_SECONDS;
  if (chunkSeconds <= 0) {
    throw new Error(`chunkSeconds must be positive, got ${chunkSeconds}`);
  }
  const duration = await getDurationSeconds(audioPath, opts.durationRunner);

  if (duration <= chunkSeconds || duration === 0) {
    return service.transcribeFile(audioPath);
  }

  const merged: string[] = [];
  let idx = 1;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-chunk-"));
  try {
    let offset = 0;
    let chunkNo = 0;
    while (offset < duration) {
      chunkNo += 1;
      const chunkPath = path.join(tmpDir, `chunk_${chunkNo}.mp3`);
      await extractChunk(audioPath, offset, chunkSeconds, chunkPath, opts.chunkRunner);
      const chunkSrt = await service.transcribeFile(chunkPath);
      const [shifted, nextIdx] = shiftAndRenumberSrt(chunkSrt, Math.trunc(offset * 1000), idx);
      idx = nextIdx;
      if (shifted.trim()) merged.push(shifted);
      offset += chunkSeconds;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return `${merged.join("\n\n")}\n`;
}
