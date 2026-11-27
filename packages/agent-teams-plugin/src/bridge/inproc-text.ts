/**
 * Wire-text rules of the lead host (task 5.16, spec "Final text cut"): a finished run's text is made well-formed UTF-16
 * (a lone surrogate becomes U+FFFD) and cut BEFORE it crosses the lane. The bridge has no access to core's
 * `maxFinalTextChars` (a server setting that the server applies again), so the cut is the contract's fallback: 256 KiB
 * of UTF-8 on a code-point boundary, followed by `… [truncated N bytes]` (N = the bytes removed).
 * See change: add-agent-teams-in-process.
 */

/** Hard cap of one text field on the lane: 256 KiB of UTF-8. */
export const FINAL_TEXT_MAX_BYTES = 256 * 1024;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** `text` with every lone surrogate replaced by U+FFFD (valid UTF-16, safe for JSON and UTF-8). */
export function toWellFormed(text: string): string {
  return text.replace(LONE_SURROGATE, "\uFFFD");
}

/** Marker appended to a cut text. */
const truncatedBytesMarker = (removedBytes: number): string => `… [truncated ${removedBytes} bytes]`;

/**
 * Well-formed `text`, cut to {@link FINAL_TEXT_MAX_BYTES} of UTF-8 on a code-point boundary with the byte-count marker.
 * Text at or below the cap is returned unchanged (apart from surrogate repair).
 */
export function cutFinalText(text: string, maxBytes: number = FINAL_TEXT_MAX_BYTES): string {
  const clean = toWellFormed(text);
  const total = Buffer.byteLength(clean, "utf8");
  if (total <= maxBytes) return clean;
  let used = 0;
  let end = 0;
  for (const ch of clean) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > maxBytes) break;
    used += size;
    end += ch.length;
  }
  return clean.slice(0, end) + truncatedBytesMarker(total - used);
}
