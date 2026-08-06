/**
 * The single source of truth for which inline image mime types the attachment
 * pipeline will take ownership of.
 *
 * Two gates consume this and MUST agree:
 *   - `prepareEventForIngest` (phase 1) decides what to strip into `pending`.
 *   - `fitImageBlockForDisplay` (phase 2) decides what it can actually fit.
 *
 * They disagreed once: ingest stripped ANY image block while the fit returned
 * a non-allow-listed mime unchanged. The resolution event then carried the
 * full-resolution bytes it was supposed to have replaced, busted the per-event
 * ceiling, truncated, and stranded the block on "pending" forever. A block
 * this module rejects is never promised a resolution in the first place — it
 * stays inline, subject to the same ceiling it always was.
 *
 * Deliberately jimp-free: the ingest path runs on the event loop for EVERY
 * event and must not pull the decoder in just to read a constant.
 *
 * See change: fit-attachments-for-display.
 */

/** Image mime types the fit can decode, re-encode, and serve. */
const FITTABLE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/**
 * True when the attachment pipeline can own a block of this mime type.
 *
 * Tolerant of real-world header shapes: case-insensitive, and it drops any
 * `; charset=…`-style parameter before matching. `image/svg+xml` is absent on
 * purpose — SVG is script-bearing markup, not a bitmap we can safely re-encode.
 */
/**
 * Base media type: lowercased, with any `; charset=…`-style parameter dropped.
 *
 * Shared so every attachment gate normalises IDENTICALLY. They have drifted
 * twice: once on the `image/jpg` alias, and once here — the serving gate only
 * lowercased, so `image/png; charset=binary` was fitted and rendered as a
 * thumbnail whose zoom then 404'd.
 */
export function normalizeImageMime(mimeType: string): string {
  return mimeType.split(";", 1)[0].trim().toLowerCase();
}

export function isFittableImageMime(mimeType: string): boolean {
  return FITTABLE_MIME.has(normalizeImageMime(mimeType));
}
