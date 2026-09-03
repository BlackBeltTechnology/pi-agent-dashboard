/**
 * Word-level inline diff between a suggestion's `original` and `replacement`.
 *
 * The corrections panel used to render the whole `original` struck-through and
 * the whole `replacement` in green. For a long sentence where only one word
 * changed, the actual correction was impossible to spot. This computes a
 * word-level diff so unchanged words render neutral and only the delta is
 * highlighted. Presentation-only — the apply/offset logic still keys on the
 * whole `original` string.
 *
 * Uses jsdiff's `diffWordsWithSpace` (already a monorepo dependency). A
 * self-contained token-LCS variant was prototyped and dropped: jsdiff splits
 * punctuation from words, so a fused change like `work.`→`works.` highlights
 * only `work`→`works`, whereas the LCS variant dragged in the unchanged
 * punctuation (e.g. it re-highlighted the whole `(world)` in `hello(world)`→
 * `hi(world)`). See change: grammar-composer-clear-and-diff.
 */

import { diffWordsWithSpace } from "diff";

export type DiffSegmentType = "equal" | "delete" | "insert";

export interface DiffSegment {
  value: string;
  type: DiffSegmentType;
}

/** Append `value` to the trailing segment when the type matches, else push. */
function pushSegment(out: DiffSegment[], type: DiffSegmentType, value: string): void {
  const last = out[out.length - 1];
  if (last && last.type === type) last.value += value;
  else out.push({ type, value });
}

/** Whitespace-preserving word-level diff of `original` → `replacement`. */
export function diffTokens(original: string, replacement: string): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const part of diffWordsWithSpace(original, replacement)) {
    const type: DiffSegmentType = part.added ? "insert" : part.removed ? "delete" : "equal";
    pushSegment(out, type, part.value);
  }
  return out;
}
