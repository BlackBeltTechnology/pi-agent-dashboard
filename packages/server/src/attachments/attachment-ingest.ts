/**
 * Ingest seam for inline image attachments (two-phase render, D3 + D12).
 *
 * Phase 1 — `prepareEventForIngest` strips full-resolution base64 out of a
 * message event and leaves a bounded PLACEHOLDER block in its place, so the
 * row event is small enough to store and broadcast immediately. The user sees
 * their own message without waiting on a 174–874 ms resize.
 *
 * Phase 2 — the fit worker returns a display derivative, and
 * `buildFittedEvent` wraps it as its own `attachment_fitted` event which is
 * stored + broadcast normally. The client reducer patches the pending block.
 *
 * Blocks are addressed by `attachmentId` = sha256 of the ORIGINAL BASE64 TEXT
 * (the exact `block.data` string, not the decoded bytes — `original-store`
 * hashes the same string, so the two agree by construction), not by sequence
 * number. That choice matters: the client's live fold
 * (`foldLiveEvents`) is append-only and never sees a seq, replay can reorder
 * relative to the row, and the same hash is the key the originals endpoint
 * needs anyway. (Fitted derivatives are NOT cached — D10.)
 *
 * See change: fit-attachments-for-display (tasks 5.2, 5.3).
 */
import { createHash } from "node:crypto";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { isAnimatedGif } from "./gif.js";
import { isFittableImageMime, normalizeImageMime } from "./image-mime.js";

/** Wire event type carrying a resolved (or failed) attachment. */
export const ATTACHMENT_FITTED_EVENT = "attachment_fitted";

export interface PendingAttachment {
  /** sha256 of the original base64 text; addresses the block across both phases. */
  attachmentId: string;
  /** Index into the message's `content` array. */
  blockIndex: number;
  /** Original, full-resolution base64 — handed to the worker, never stored. */
  data: string;
  mimeType: string;
}

export interface PreparedEvent {
  /** Event safe to store/broadcast now. Same reference when nothing changed. */
  event: DashboardEvent;
  pending: PendingAttachment[];
}

/**
 * True for a base64 image content block carrying real bytes THAT THE FIT CAN
 * ACTUALLY HANDLE.
 *
 * The mime check is the admission gate, not a nicety: stripping a block the
 * fit will decline to fit promises a resolution event that can never arrive
 * (see `image-mime.ts`). An unfittable block is left inline, untouched.
 */
function isImageContentBlock(b: unknown): b is { type: string; data: string; mimeType: string } {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  return (
    r.type === "image" &&
    typeof r.data === "string" &&
    r.data.length > 0 &&
    typeof r.mimeType === "string" &&
    isFittableImageMime(r.mimeType)
  );
}

/**
 * True when a block should enter the two-phase flow.
 *
 * Mime admission is not sufficient: the fit EXEMPTS animated GIFs (D11, never
 * flatten an animation), and the spec's two-phase boundary requires that the
 * gate removing an attachment's bytes and the gate fitting them admit exactly
 * the same set. Stripping an animated GIF promised a resolution the fit would
 * never produce, and the resolver's byte-budget guard then resolved it FAILED
 * — so a pasted animated GIF vanished instead of playing. Left inline, it stays
 * subject to the same per-event ceiling it always was.
 *
 * The probe decodes only GIF blocks, and only walks their block stream — no
 * image decoding, so nothing heavyweight reaches the main thread.
 */
function entersTwoPhase(b: unknown): b is { type: string; data: string; mimeType: string } {
  if (!isImageContentBlock(b)) return false;
  if (normalizeImageMime(b.mimeType) !== "image/gif") return true;
  try {
    return !isAnimatedGif(Buffer.from(b.data, "base64"));
  } catch {
    return true; // undecodable: let the fit path decide and fail honestly
  }
}

/**
 * Content-address a block by its original base64 text.
 *
 * Hashes the STRING, not the decoded bytes: `findOriginalInTranscript` hashes
 * the same stored string, so ingest and recovery agree without decoding every
 * candidate block during the scan. Caveat: base64 has several valid spellings
 * of the same bytes, so this digest is encoding-sensitive — safe today because
 * there is exactly ONE producer (below), and the stored string is the one that
 * was hashed.
 */
export function attachmentIdFor(base64: string): string {
  return createHash("sha256").update(base64, "utf8").digest("hex");
}

/**
 * Replace every inline image block with a pending placeholder.
 *
 * Returns the ORIGINAL event reference untouched when there is nothing to do,
 * so the overwhelmingly common no-image path allocates nothing.
 */
export function prepareEventForIngest(event: DashboardEvent): PreparedEvent {
  const data = event.data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return { event, pending: [] };
  if (!content.some(entersTwoPhase)) return { event, pending: [] };

  const pending: PendingAttachment[] = [];
  const nextContent = content.map((block, blockIndex) => {
    if (!entersTwoPhase(block)) return block;
    const attachmentId = attachmentIdFor(block.data);
    pending.push({ attachmentId, blockIndex, data: block.data, mimeType: block.mimeType });
    // Placeholder: keeps the block's POSITION and mime so the client can
    // reserve the right slot, but carries no bytes.
    return {
      ...block,
      data: "",
      attachmentId,
      attachmentState: "pending" as const,
    };
  });

  return {
    event: {
      ...event,
      data: { ...data, message: { ...message, content: nextContent } },
    },
    pending,
  };
}

export interface FittedEventInput {
  attachmentId: string;
  /** Fitted base64, or "" when the fit failed. */
  data: string;
  mimeType: string;
  state: "ready" | "failed";
}

/**
 * Build the phase-2 resolution event. Stored and broadcast like any other
 * event, so replay redelivers it after its row and the fold converges.
 */
export function buildFittedEvent(input: FittedEventInput): DashboardEvent {
  return {
    eventType: ATTACHMENT_FITTED_EVENT,
    timestamp: Date.now(),
    data: {
      attachmentId: input.attachmentId,
      data: input.data,
      mimeType: input.mimeType,
      state: input.state,
    },
  };
}
