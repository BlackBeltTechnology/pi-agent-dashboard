/**
 * Canonical detection + accessors for inline image content blocks, shared by
 * the server (event-store truncation) and the client (chat reducer). Two shapes
 * reach the dashboard and MUST be handled identically wherever image blocks are
 * inspected, or the two sites silently drift:
 *
 *   - flat pi shape      : `{ type: "image", data, mimeType }`   (pi SDK ImageContent)
 *   - nested Anthropic   : `{ type: "image", source: { type: "base64", media_type, data } }`
 *
 * Blocks may also be two-phase attachment placeholders: `data` blanked, an
 * `attachmentId` (+ optional `attachmentState`) present, to be back-filled by a
 * later `attachment_fitted` event.
 *
 * See change: fix-pasted-image-message-vanishes.
 */

/** Loosely-typed content block as it arrives over the wire / from a transcript. */
type UnknownBlock = Record<string, unknown>;

function asBlock(block: unknown): UnknownBlock | null {
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  return block as UnknownBlock;
}

/** True when `block` is an `image`-typed content block (either shape). */
export function isImageTypeBlock(block: unknown): boolean {
  const b = asBlock(block);
  return !!b && b.type === "image";
}

/**
 * The base64 image bytes carried inline by `block`, across both shapes, or
 * `undefined` when there are none (e.g. a blanked two-phase placeholder).
 */
export function imageBlockData(block: unknown): string | undefined {
  const b = asBlock(block);
  if (!b || b.type !== "image") return undefined;
  if (typeof b.data === "string" && b.data.length > 0) return b.data;
  const src = b.source as UnknownBlock | undefined;
  if (src && typeof src === "object" && typeof src.data === "string" && src.data.length > 0) {
    return src.data;
  }
  return undefined;
}

/**
 * The mime type of `block` across both shapes (flat `mimeType`, nested
 * `source.media_type`), or `undefined` when absent.
 */
export function imageBlockMime(block: unknown): string | undefined {
  const b = asBlock(block);
  if (!b || b.type !== "image") return undefined;
  if (typeof b.mimeType === "string") return b.mimeType;
  const src = b.source as UnknownBlock | undefined;
  if (src && typeof src === "object" && typeof src.media_type === "string") {
    return src.media_type as string;
  }
  return undefined;
}

/**
 * True when `block` is an image block that carries inline base64 bytes (flat or
 * nested). These are the blocks whose bytes the server strips out of an
 * over-ceiling message. Blanked two-phase placeholders (no bytes) return false.
 */
export function isInlineImageBlock(block: unknown): boolean {
  return imageBlockData(block) !== undefined;
}

/**
 * True when `block` is a renderable image block: it has a mime AND either
 * inline bytes or a two-phase `attachmentId` placeholder. Used by the client to
 * decide which content blocks become rendered image attachments.
 */
export function isRenderableImageBlock(block: unknown): boolean {
  const b = asBlock(block);
  if (!b || b.type !== "image") return false;
  const hasImageSource =
    imageBlockData(b) !== undefined ||
    (typeof b.attachmentId === "string" && b.attachmentId.length > 0);
  const mime = imageBlockMime(b);
  return hasImageSource && typeof mime === "string" && mime.length > 0;
}
