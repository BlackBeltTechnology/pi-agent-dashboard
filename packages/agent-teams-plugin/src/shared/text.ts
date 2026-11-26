/**
 * Text rules shared by every op and the mail renderer (tasks 2.7 / 2.12):
 * lengths count CODE POINTS, C0/C1/ANSI/bidi controls are stripped silently
 * (`\n` and `\t` survive in mail bodies), and cuts land on a code-point
 * boundary. No regex over control characters: a small scanner keeps the rules
 * auditable and lint-clean.
 * See change: add-agent-teams-core.
 */

export interface SanitizeOptions {
  /** Keep `\n` and `\t` (mail bodies). CR and CRLF normalise to `\n`. When false every control is dropped. */
  keepNewlines: boolean;
}

const BIDI_AND_MARKS = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

/** Index just past a CSI sequence (`ESC [` params/intermediates, one final byte 0x40–0x7e) starting at `i`. */
function skipCsi(s: string, i: number): number {
  let j = i + 2;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    j++;
    if (c >= 0x40 && c <= 0x7e) break;
  }
  return j;
}

/** Index just past an OSC sequence (`ESC ]` … BEL or ST) starting at `i`. */
function skipOsc(s: string, i: number): number {
  let j = i + 2;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 0x07) return j + 1;
    if (c === 0x1b && s.charCodeAt(j + 1) === 0x5c) return j + 2;
    j++;
  }
  return j;
}

/** Index just past the ANSI escape sequence that starts at `s[i]` (an ESC). */
function skipEscape(s: string, i: number): number {
  const next = s.charCodeAt(i + 1);
  if (next === 0x5b) return skipCsi(s, i);
  if (next === 0x5d) return skipOsc(s, i);
  return Math.min(s.length, i + 2);
}

/** Always-stripped code units: C0 (except handled whitespace), DEL, C1 and bidi/mark controls. */
function isStripped(c: number): boolean {
  return c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || BIDI_AND_MARKS.has(c);
}

/** Whitespace/line controls: `\n` `\t` kept in mail bodies, CR/LS/PS normalised to `\n`, else dropped. */
function lineControl(c: number, nextIsLf: boolean, keep: boolean): { out: string; skip: number } | undefined {
  if (c === 0x0d) return { out: keep ? "\n" : "", skip: keep && nextIsLf ? 1 : 0 };
  if (c === 0x0a || c === 0x09) return { out: keep ? String.fromCharCode(c) : "", skip: 0 };
  if (c === 0x2028 || c === 0x2029) return { out: keep ? "\n" : "", skip: 0 };
  return undefined;
}

export function sanitizeText(input: string, opts: SanitizeOptions): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input.charCodeAt(i);
    if (c === 0x1b) {
      i = skipEscape(input, i);
      continue;
    }
    i++;
    const line = lineControl(c, input.charCodeAt(i) === 0x0a, opts.keepNewlines);
    if (line) {
      out += line.out;
      i += line.skip;
    } else if (!isStripped(c)) {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** First `max` code points of `s` (never splits a surrogate pair). */
export function truncateCodePoints(s: string, max: number): string {
  if (s.length <= max) return s;
  let n = 0;
  let out = "";
  for (const ch of s) {
    if (n === max) return out;
    out += ch;
    n++;
  }
  return out;
}

/**
 * Cut `s` to `max` code points and append `marker` when it was longer
 * (the marker is extra, so the visible text is never silently shorter than the cap).
 * Used ONLY for `result` and `finalText`; every other over-limit field is rejected.
 */
export function truncateWithMarker(s: string, max: number, marker: string): string {
  if (codePointLength(s) <= max) return s;
  return truncateCodePoints(s, max) + marker;
}
