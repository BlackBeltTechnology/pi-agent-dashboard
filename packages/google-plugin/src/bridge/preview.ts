/**
 * Confirm-dialog preview helpers (scenario-gate C3): text ≤ 500 chars, first 5 rows, ≤ 20 attendees/targets
 * followed by "+N more". Everything shown is plain text — control characters (incl. ESC and newlines) and bidi
 * overrides are neutralised — and bounded, while the API call receives the full content.
 * See change: add-google-connect.
 */
import { sanitize } from "../shared/google-errors.js";

export const PREVIEW_TEXT_CHARS = 500;
export const PREVIEW_ROWS = 5;
export const PREVIEW_TARGETS = 20;
const SUMMARY_MAX_CHARS = 2000;

/** One plain-text line, ≤ `max` chars; a longer text ends with `… (<total> chars)`. */
export function clip(value: unknown, max: number = PREVIEW_TEXT_CHARS): string {
  const full = typeof value === "string" ? value : String(value ?? "");
  const t = sanitize(full, Number.MAX_SAFE_INTEGER) ?? "";
  return t.length > max ? `${t.slice(0, max)}\u2026 (${t.length} chars)` : t;
}

/** `a, b, c, … +N more` over the first `max` items (each clipped to one short field). */
export function listed(items: readonly string[], max: number = PREVIEW_TARGETS): string {
  const shown = items.slice(0, max).map((s) => clip(s, 120));
  const more = items.length - shown.length;
  return more > 0 ? `${shown.join(", ")}, \u2026 +${more} more (${items.length} total)` : shown.join(", ");
}

/** The first `max` rows as `- <row>` lines, then a `… +N more rows (<total> total)` marker. */
export function rowLines(rows: readonly string[], max: number = PREVIEW_ROWS): string[] {
  const out = rows.slice(0, max).map((r) => `- ${clip(r)}`);
  if (rows.length > max) out.push(`\u2026 +${rows.length - max} more rows (${rows.length} total)`);
  return out;
}

/** Final join of a confirm body; a whole summary is bounded as well, whatever the product put in it. */
export function joinSummary(lines: readonly string[]): string {
  const text = lines.join("\n");
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}\n\u2026 (${text.length} chars)` : text;
}
