/**
 * SRT reader for speaker-id relabeling. `srt.ts` only *writes*; this module
 * parses an existing SRT back into cues, each carrying an optional `[label]`
 * prefix, groups cues into speaker clusters, and renders cues back to SRT.
 *
 * Label taxonomy (the source SRT is never the place we guess names):
 *   - anonymous  — `[Speaker N]` (what `srt.ts` renders) or a bare `[N]`
 *                  (older standalone-tool transcripts). Both normalise to the
 *                  same cluster id.
 *   - named      — anything else in brackets (`[Alice]`, `[Interviewer]`); a
 *                  transcript carrying one is "already labeled".
 *   - annotation — a non-speaker bracket (`[music]`, `[inaudible]`) is *not a
 *                  label at all*: the cue stays unlabeled so it forms no cluster
 *                  and does not make the transcript count as already-labeled.
 *
 * See change: add-speaker-id-enrollment.
 */
import * as fs from "node:fs";

export interface Cue {
  /** Original cue index line; synthesised when the input omitted it. */
  index: string;
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Original label text, e.g. `Speaker 2` or `2`. Undefined when unlabeled. */
  label?: string;
  /** Cue text with a recognised label stripped; a sound annotation is kept. */
  text: string;
}

const TIME_RE =
  /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
const LABEL_RE = /^\s*\[([^\]]{1,40})\]\s*/;
const ANON_RE = /^(?:speaker\s+)?(\d+)$/i;

/**
 * Canonical non-speech annotations. Any *lowercase* bracket is also treated as
 * an annotation (see `isSoundAnnotation`) so an unlisted `[humming]` degrades
 * to unlabeled rather than being offered as a nameable cluster.
 */
const SOUND_ANNOTATIONS = new Set([
  "music",
  "inaudible",
  "unintelligible",
  "silence",
  "noise",
  "laughter",
  "applause",
  "crosstalk",
  "background",
  "sound",
  "sighs",
  "cough",
  "static",
]);

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

/** Format seconds back to an SRT timestamp (`HH:MM:SS,mmm`). */
export function formatCueTime(seconds: number): string {
  let ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/** True for an anonymous speaker label: `Speaker 3` or a bare `3`. */
export function isAnonymousLabel(label: string): boolean {
  return ANON_RE.test(label.trim());
}

/** True when a bracket is a non-speaker sound annotation, not a label. */
export function isSoundAnnotation(label: string): boolean {
  const value = label.trim();
  if (SOUND_ANNOTATIONS.has(value.toLowerCase())) return true;
  // Names/roles are conventionally capitalised; sound annotations are lowercase.
  return value.length > 0 && value === value.toLowerCase() && /[a-z]/.test(value);
}

/**
 * Normalise a label to a cluster id, so `[Speaker 2]` and `[2]` refer to the
 * same cluster. Named labels keep their exact text.
 */
export function normalizeLabel(label: string): string {
  const value = label.trim();
  const m = ANON_RE.exec(value);
  return m ? m[1] : value;
}

/** Find the timing line in a block, and its index among the block's lines. */
function findTimeLine(lines: string[]): { match: RegExpExecArray; index: number } | null {
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const match = TIME_RE.exec(lines[i]);
    if (match) return { match, index: i };
  }
  return null;
}

/** Split a cue's text into an optional recognised label and the remaining text. */
function splitLabel(rawText: string): { label?: string; text: string } {
  const lm = LABEL_RE.exec(rawText);
  if (lm && !isSoundAnnotation(lm[1].trim())) {
    return { label: lm[1].trim(), text: rawText.slice(lm[0].length).trim() };
  }
  return { text: rawText };
}

/** Parse one SRT block into a cue, or null when it is not a cue. */
function parseBlock(block: string, fallbackIndex: number): Cue | null {
  const lines = block.split(/\r?\n/).filter((ln) => ln.trim());
  if (lines.length < 2) return null;
  const timed = findTimeLine(lines);
  if (!timed) return null;

  const index = timed.index > 0 ? lines[0].trim() : String(fallbackIndex);
  // Multi-line cue text is joined with a space (this package's own writer emits
  // one line per cue), so parse→render is faithful for single-line text.
  const rawText = lines
    .slice(timed.index + 1)
    .join(" ")
    .trim();
  const { label, text } = splitLabel(rawText);
  const [, h, m, s, ms, eh, em, es, ems] = timed.match;

  return {
    index,
    start: toSeconds(h, m, s, ms),
    end: toSeconds(eh, em, es, ems),
    label,
    text,
  };
}

/** Parse an SRT body (BOM tolerated) into cues. */
export function parseSrt(body: string): Cue[] {
  const blocks = body.replace(/^\uFEFF/, "").trim().split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const cue = parseBlock(block, cues.length + 1);
    if (cue) cues.push(cue);
  }
  return cues;
}

/** Parse an SRT file (UTF-8) into cues. */
export function parseSrtFile(file: string): Cue[] {
  return parseSrt(fs.readFileSync(file, "utf8"));
}

/** Render cues back to an SRT body, preserving indices, timestamps and text. */
export function renderSrt(cues: Cue[]): string {
  const blocks = cues.map((c) => {
    const tag = c.label !== undefined ? `[${c.label}] ` : "";
    return `${c.index}\n${formatCueTime(c.start)} --> ${formatCueTime(c.end)}\n${tag}${c.text}\n`;
  });
  return blocks.join("\n");
}

/**
 * Group cues into clusters keyed by normalised label. Unlabeled cues (including
 * sound annotations) form no cluster.
 */
export function clusterCues(cues: Cue[]): Map<string, Cue[]> {
  const groups = new Map<string, Cue[]>();
  for (const c of cues) {
    if (c.label === undefined) continue;
    const key = normalizeLabel(c.label);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  return groups;
}

/** True when any cue carries a non-anonymous (name/role) label. */
export function hasNamedLabels(cues: Cue[]): boolean {
  return cues.some((c) => c.label !== undefined && !isAnonymousLabel(c.label));
}
