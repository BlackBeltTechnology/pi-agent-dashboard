/**
 * ask-user attachment store.
 *
 * Persists images pasted into `ask_user{method:"input"}` (standalone and the
 * batch `input` step) to disk so the LLM's `Read` tool can open them. Files
 * live under `~/.pi/dashboard/attachments/<sessionId>/<hash>.<ext>`,
 * content-addressable (sha256 truncated to 16 hex chars), so re-pastes dedup.
 *
 * Pure I/O helper — no bridge/promptBus coupling. The bridge owns sessionId +
 * connection and calls these from its `ctx.ui.inputWithImages` / `ctx.ui.batch`
 * patches and its `session_end` handler.
 *
 * See change: add-ask-user-input-multiline-paste.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Caps mirror markdown-image-inliner (symmetric assistant/user direction).
export const MAX_PER_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PER_MESSAGE_BYTES = 20 * 1024 * 1024;

/** MIME → file extension allowlist. Mirrors the paste-side supported types. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

/**
 * Per-session attachment directory under the dashboard home tree.
 * Validates `sessionId` (bridge-supplied, but defense-in-depth): a value
 * containing path separators or `..` could escape the attachments root.
 */
export function attachmentDirForSession(sessionId: string): string {
  if (sessionId.includes("/") || sessionId.includes(path.sep) || sessionId.includes("..")) {
    throw new Error(`[ask-user-attachments] invalid sessionId: ${sessionId}`);
  }
  return path.join(os.homedir(), ".pi", "dashboard", "attachments", sessionId);
}

/** File extension for a MIME type, or null if not in the allowlist. */
export function extensionForMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

/** sha256(bytes) truncated to 16 hex chars (matches markdown-image-inliner.hashBytes). */
export function hashBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export interface PersistedAttachment {
  path: string;
  mimeType: string;
  bytes: number;
  /** Content hash — bridge uses it to dedup asset_register emission. */
  hash: string;
}

/**
 * Persist one image to disk. Idempotent: skips the write when the
 * content-addressable file already exists. Returns metadata, or null when the
 * MIME is unsupported, the image exceeds the per-image cap, or the write fails
 * (logged, then dropped — partial success beats rejecting the whole response).
 */
export function persistAttachment(opts: {
  sessionId: string;
  image: ImageContent;
}): PersistedAttachment | null {
  const { sessionId, image } = opts;
  const ext = extensionForMime(image.mimeType);
  if (!ext) {
    console.warn(`[ask-user-attachments] unsupported MIME dropped: ${image.mimeType}`);
    return null;
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(image.data, "base64");
  } catch (err) {
    console.warn(`[ask-user-attachments] base64 decode failed: ${String(err)}`);
    return null;
  }

  if (bytes.length > MAX_PER_IMAGE_BYTES) {
    console.warn(
      `[ask-user-attachments] image over per-image cap dropped: ${bytes.length} > ${MAX_PER_IMAGE_BYTES}`,
    );
    return null;
  }

  const hash = hashBytes(bytes);
  const dir = attachmentDirForSession(sessionId);
  const filePath = path.join(dir, `${hash}${ext}`);

  try {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, bytes);
    }
  } catch (err) {
    console.error(`[ask-user-attachments] write failed for ${filePath}: ${String(err)}`);
    return null;
  }

  return { path: filePath, mimeType: image.mimeType, bytes: bytes.length, hash };
}

/** Best-effort recursive removal of a session's attachment directory. */
export function cleanupAttachmentsForSession(sessionId: string): void {
  const dir = attachmentDirForSession(sessionId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[ask-user-attachments] cleanup failed for ${dir}: ${String(err)}`);
  }
}
