/**
 * Places grammar suggestions inline over the current draft so the corrections
 * panel can render the whole sentence on one line (the "redline" view). The
 * four redline modes (redline / compact / original / corrected) all derive
 * from this one segment list — the renderers only differ in how they draw a
 * `change` segment.
 *
 * Each suggestion is located the SAME way {@link useGrammarCheck}'s `accept`
 * applies it: prefer the recorded `offset` when the slice still equals
 * `original`, else forward-search (`indexOf`). Suggestions that cannot be
 * located (the draft was edited) are DROPPED rather than drawn at a wrong
 * position — mirroring the list view's staleness handling. Overlapping spans
 * keep the earlier one. Presentation-only: applying a change still keys on the
 * whole `original` via the hook. See change: add-grammar-compact-view.
 */

import type { GrammarSuggestion } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";

export type RedlineSegment<T extends GrammarSuggestion = GrammarSuggestion> =
  | { type: "unchanged"; text: string }
  | { type: "change"; suggestion: T; start: number; end: number };

/** Locate `original` in `draft`: offset-first, then a forward `indexOf`. `-1` = not found. */
function locate(draft: string, offset: number, original: string): number {
  if (!original) return -1;
  if (draft.slice(offset, offset + original.length) === original) return offset;
  return draft.indexOf(original);
}

/**
 * Interleave `unchanged` text runs with `change` segments for each locatable
 * suggestion, in draft order. Empty unchanged runs are omitted.
 */
export function buildRedlineSegments<T extends GrammarSuggestion>(
  draft: string,
  suggestions: readonly T[],
): RedlineSegment<T>[] {
  const located = suggestions
    .map((s) => {
      const start = locate(draft, s.offset, s.original);
      return start === -1 ? null : { suggestion: s, start, end: start + s.original.length };
    })
    .filter((x): x is { suggestion: T; start: number; end: number } => x !== null)
    .sort((a, b) => a.start - b.start);

  const out: RedlineSegment<T>[] = [];
  let cursor = 0;
  for (const span of located) {
    if (span.start < cursor) continue; // overlaps an already-emitted change — drop it
    if (span.start > cursor) out.push({ type: "unchanged", text: draft.slice(cursor, span.start) });
    out.push({ type: "change", suggestion: span.suggestion, start: span.start, end: span.end });
    cursor = span.end;
  }
  if (cursor < draft.length) out.push({ type: "unchanged", text: draft.slice(cursor) });
  if (out.length === 0) out.push({ type: "unchanged", text: draft });
  return out;
}
