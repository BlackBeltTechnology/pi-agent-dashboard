/**
 * SRT builder — pure functions ported verbatim from the Python skill.
 *
 * Segmentation: tokens are grouped by speaker, breaking on speaker change or
 * once a segment spans `maxSegmentMs` (5000). Timestamps format as
 * `HH:MM:SS,mmm`. Byte-comparable to the Python output.
 */

export interface Token {
  text?: string;
  speaker?: string;
  start_ms?: number;
  end_ms?: number;
}

export interface Segment {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}

const DEFAULT_SPEAKER = "Speaker 1";
const MAX_SEGMENT_MS = 5000;

/** Format milliseconds to an SRT timestamp (`HH:MM:SS,mmm`). */
export function formatTimestamp(milliseconds: number): string {
  let ms = milliseconds;
  const hours = Math.floor(ms / 3600000);
  ms %= 3600000;
  const minutes = Math.floor(ms / 60000);
  ms %= 60000;
  const seconds = Math.floor(ms / 1000);
  ms %= 1000;

  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
}

/**
 * Group tokens into subtitle segments by speaker + timing. A new segment starts
 * on speaker change or once the current segment spans `maxSegmentMs`. Tokens
 * with blank text are skipped; Soniox tokens already include spacing.
 */
export function groupTokens(tokens: Token[], maxSegmentMs: number = MAX_SEGMENT_MS): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const token of tokens) {
    const text = token.text ?? "";
    const speaker = token.speaker ?? DEFAULT_SPEAKER;
    const startMs = token.start_ms ?? 0;
    const endMs = token.end_ms ?? 0;

    if (!text.trim()) continue;

    if (current === null) {
      current = { start_ms: startMs, end_ms: endMs, speaker, text };
    } else if (current.speaker === speaker && startMs - current.start_ms < maxSegmentMs) {
      current.text += text;
      current.end_ms = endMs;
    } else {
      segments.push(current);
      current = { start_ms: startMs, end_ms: endMs, speaker, text };
    }
  }

  if (current) segments.push(current);
  return segments;
}

/** Convert a Soniox transcript (with `tokens`) to an SRT string. */
export function tokensToSrt(transcript: { tokens?: Token[] }): string {
  const tokens = transcript.tokens ?? [];
  if (tokens.length === 0) return "";

  const segments = groupTokens(tokens);
  const lines: string[] = [];
  segments.forEach((segment, i) => {
    const startTime = formatTimestamp(segment.start_ms);
    const endTime = formatTimestamp(segment.end_ms);
    lines.push(String(i + 1));
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(`[${segment.speaker}] ${segment.text}`);
    lines.push("");
  });

  return lines.join("\n");
}
