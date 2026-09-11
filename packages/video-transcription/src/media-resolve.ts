/**
 * Resolve the audio for an SRT: explicit `--audio` first, then a sibling media
 * file by a **fixed** extension precedence (never readdir order). Also owns the
 * one-sided duration check that refuses media shorter than the transcript.
 *
 * Precedence mirrors `discover.ts` (the set this package actually produces
 * transcripts from): `.mkv`, `.mp4`, `.mov`, `.m4a`, `.mp3`; a `.mp4` beside
 * `talk.m4a`/`talk.mp3` therefore wins deterministically.
 *
 * See change: add-speaker-id-enrollment.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Sibling media extensions in descending precedence. */
export const MEDIA_EXTENSIONS = [".mkv", ".mp4", ".mov", ".m4a", ".mp3"] as const;

/** How much shorter than the last cue the media may be before we refuse. */
const DURATION_TOLERANCE_SECONDS = 2;

/** SRT suffixes stripped to recover the media basename. */
const SRT_SUFFIXES = [".diarize.srt", ".named.srt", ".srt"];

/** The media basename for an SRT path: `talk.diarize.srt` -> `talk`. */
export function mediaStem(srtPath: string): string {
  const base = path.basename(srtPath);
  for (const suffix of SRT_SUFFIXES) {
    if (base.endsWith(suffix)) return base.slice(0, -suffix.length);
  }
  return base.replace(/\.[^./\\]+$/, "");
}

/** Candidate sibling media paths for an SRT, in precedence order. */
export function mediaCandidates(srtPath: string): string[] {
  const dir = path.dirname(srtPath);
  const stem = mediaStem(srtPath);
  return MEDIA_EXTENSIONS.map((ext) => path.join(dir, `${stem}${ext}`));
}

/** First existing sibling media path, or null. */
export function findSiblingMedia(
  srtPath: string,
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  return mediaCandidates(srtPath).find((p) => exists(p)) ?? null;
}

/**
 * Resolve the media path: explicit override, else sibling discovery. Throws
 * naming every path tried when nothing resolves.
 */
export function resolveMediaPath(
  srtPath: string,
  explicit?: string,
  exists: (p: string) => boolean = fs.existsSync,
): string {
  if (explicit) {
    if (exists(explicit)) return explicit;
    throw new Error(`audio file not found: ${explicit}`);
  }
  const found = findSiblingMedia(srtPath, exists);
  if (found) return found;
  throw new Error(
    `no media file found for ${path.basename(srtPath)}. Tried:\n  ` +
      mediaCandidates(srtPath).join("\n  ") +
      "\nPass --audio <path> to name it explicitly.",
  );
}

/**
 * One-sided duration check. Media *longer* than the last cue is normal
 * (trailing silence) and passes. A duration of `0` means the probe was absent
 * or unparseable and skips the check with a note — never an infinite mismatch.
 */
export function checkMediaDuration(
  mediaDuration: number,
  lastCueEnd: number,
  tolerance: number = DURATION_TOLERANCE_SECONDS,
): { ok: boolean; note?: string } {
  if (!(mediaDuration > 0)) {
    return { ok: true, note: "media duration unknown — skipped the length check" };
  }
  if (lastCueEnd > mediaDuration + tolerance) {
    return {
      ok: false,
      note:
        `media is ${mediaDuration.toFixed(1)}s but the transcript runs to ` +
        `${lastCueEnd.toFixed(1)}s — refusing to embed ranges that do not exist`,
    };
  }
  return { ok: true };
}
