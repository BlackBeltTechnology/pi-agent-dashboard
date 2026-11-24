/**
 * Paging conventions for read tools (scenario-gate C6): lists return at most 50 items plus Google's
 * `nextPageToken`; Docs/Slides-style text is cut at 20 000 chars with a `nextOffset`.
 * See change: add-google-connect.
 */
export const LIST_PAGE_SIZE = 50;
export const TEXT_PAGE_CHARS = 20_000;

/** The `maxResults` / `pageSize` to send: the caller's value clamped to 1…50, default 50. */
export function pageSize(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : LIST_PAGE_SIZE;
  return Math.min(LIST_PAGE_SIZE, Math.max(1, n));
}

/** One window of `text` from `offset`; `nextOffset` is present while more text remains. */
export function pageText(text: string, offset: unknown = 0, limit: number = TEXT_PAGE_CHARS): { text: string; offset: number; total: number; nextOffset?: number } {
  const from = typeof offset === "number" && Number.isFinite(offset) ? Math.min(Math.max(0, Math.floor(offset)), text.length) : 0;
  const to = Math.min(text.length, from + limit);
  return { text: text.slice(from, to), offset: from, total: text.length, ...(to < text.length ? { nextOffset: to } : {}) };
}
