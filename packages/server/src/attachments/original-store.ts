/**
 * Recovery of full-resolution attachment originals.
 *
 * D7: the session transcript IS the record — pi already writes full-resolution
 * bytes there — so nothing durable needs to be added. Any blob cache layered on
 * top is an optimisation whose miss is recoverable from here.
 *
 * Security posture (this module is the trust boundary for a binary surface):
 *  - Attachment ids are content hashes, validated against a strict 64-char
 *    lowercase-hex shape. Nothing derived from request input ever reaches a
 *    filesystem path, so traversal is structurally impossible (X3).
 *  - Lookup is scoped to ONE session's transcript, so a valid digest belonging
 *    to another session simply is not found — cross-session reads are refused
 *    without needing a separate ownership table (X2).
 *  - Only allow-listed raster image types are recoverable. A blob claiming
 *    `text/html` (or `image/svg+xml`, which is scriptable) is never returned,
 *    so the endpoint cannot be used to serve active content (E15).
 *
 * See change: fit-attachments-for-display (task 5.7, D7/D8).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * Image types that may be recovered and served. Deliberately excludes
 * `image/svg+xml`: SVG is XML that can carry script, so serving it inline from
 * the dashboard origin would be an XSS vector.
 */
export const ALLOWED_IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  // Non-standard alias of image/jpeg that real clients still emit. The fit
  // gate accepts it, so omitting it here admitted an attachment that rendered
  // fitted but 404'd the moment the user clicked to zoom. Widens the served
  // surface by an ALIAS of a format already served, not by a new format.
  "image/jpg",
  "image/gif",
  "image/webp",
]);

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_IMAGE_MIME.has(mime.toLowerCase());
}

/**
 * Strict content-hash shape: exactly 64 lowercase hex chars, anchored.
 *
 * Rejecting (rather than normalising) uppercase keeps one canonical form, so a
 * cache keyed on the id cannot be split across two spellings of one digest.
 */
const ATTACHMENT_ID_RE = /^[0-9a-f]{64}$/;

export function isValidAttachmentId(id: string): boolean {
  return typeof id === "string" && ATTACHMENT_ID_RE.test(id);
}

export interface RecoveredOriginal {
  bytes: Buffer;
  mimeType: string;
}

/** Depth-bounded walk for `{type:"image", data, mimeType}` blocks. */
function* imageBlocksIn(value: unknown, depth = 0): Generator<{ data: string; mimeType: string }> {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) yield* imageBlocksIn(item, depth + 1);
    return;
  }
  const rec = value as Record<string, unknown>;
  if (rec.type === "image" && typeof rec.data === "string" && typeof rec.mimeType === "string") {
    yield { data: rec.data, mimeType: rec.mimeType };
  }
  for (const v of Object.values(rec)) yield* imageBlocksIn(v, depth + 1);
}

/**
 * Scan a session transcript for the image whose base64 payload hashes to
 * `attachmentId`.
 *
 * Streams line-by-line rather than reading the file into memory: a session
 * transcript can be tens of MB and this runs on a request path. Peak memory is
 * bounded by the largest single JSONL entry, not by the file (P4).
 *
 * Resolves `null` — never throws — for a missing/unreadable transcript, an
 * absent hash, or a hash whose block carries a non-allow-listed type, so the
 * caller renders one clean 404 for every "cannot serve this" case (X6).
 */
export async function findOriginalInTranscript(
  sessionFile: string,
  attachmentId: string,
): Promise<RecoveredOriginal | null> {
  if (!isValidAttachmentId(attachmentId)) return null;

  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(sessionFile, { encoding: "utf8" });
  } catch {
    return null;
  }

  try {
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // a partially-written or corrupt line must not abort recovery
      }
      for (const block of imageBlocksIn(parsed)) {
        const digest = createHash("sha256").update(block.data, "utf8").digest("hex");
        if (digest !== attachmentId) continue;
        // Hash matched — but only serve it if its declared type is allow-listed.
        if (!isAllowedImageMime(block.mimeType)) return null;
        rl.close();
        return {
          bytes: Buffer.from(block.data, "base64"),
          mimeType: block.mimeType.toLowerCase(),
        };
      }
    }
    return null;
  } catch {
    return null; // ENOENT and read errors alike → clean 404, never a crash
  } finally {
    stream.destroy();
  }
}
