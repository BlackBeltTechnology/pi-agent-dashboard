/**
 * The bridge-owned steer buffer: dashboard-originated steers held while the
 * agent streams, CANCELLABLE until the bridge hands them to pi.
 *
 * A steer is in exactly one place: here (cancellable) or inside pi (not
 * cancellable — pi's ExtensionAPI exposes no queue removal). The hand-off is a
 * single synchronous `take()` inside the bridge's awaited `turn_end` handler
 * (completed turns only) or a `shift()` in the settle drain; the entry leaves
 * this buffer in the same step that commits it to pi, so a cancel can never
 * reach an entry pi may already hold (design D2).
 *
 * Bounds mirror the follow-up buffer (same `FOLLOWUP_QUEUE_CAP` and
 * `FOLLOWUP_BUFFER_MAX_BYTES` constants), accounted INDEPENDENTLY. Refusal is
 * whole-entry; images are never stripped. Totals are recomputed from live
 * entries on each admission (no drift — see `followup-buffer.ts`).
 *
 * Ids are `<instanceNonce>:<seq>`: a reloaded bridge mints a fresh nonce, so an
 * id is never reused across bridge lifetimes and a stale cancel can never hit
 * a new entry.
 *
 * Transport-free: returns decisions; `bridge.ts` owns `queue_update` /
 * `command_feedback` emission. See change: bridge-owned-cancellable-steer (D6).
 */

import type { ImageContent, SteerEntryView } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { validateImages } from "./command-handler.js";
import { entryBytes, FOLLOWUP_BUFFER_MAX_BYTES, FOLLOWUP_QUEUE_CAP } from "./followup-buffer.js";

/** One held steer. `promptId` is acked when (and only if) the steer reaches pi. */
interface SteerEntry {
  id: string;
  text: string;
  images?: ImageContent[];
  promptId?: string;
}

/** pi's `steeringMode` setting: how many steers its loop drains per boundary. */
export type SteeringMode = "one-at-a-time" | "all";

type AdmitResult =
  | { ok: true; id: string }
  | { ok: false; reason: "cap" | "bytes"; message: string };

export interface SteerBuffer {
  readonly length: number;
  entries(): readonly SteerEntry[];
  totalBytes(): number;
  /** Wire projection: id + text + image COUNT. Bytes never cross the wire. */
  views(): SteerEntryView[];
  /** Append, subject to both bounds. Mints the entry id. */
  push(entry: Omit<SteerEntry, "id">): AdmitResult;
  /** Cancel one entry by id. `false` = unknown (already sent or cancelled). */
  removeById(id: string): boolean;
  /** Drop every entry. Returns whether anything was removed. */
  clear(): boolean;
  /** Remove + return the entries pi's loop will drain at this boundary, oldest first. */
  take(mode: SteeringMode): SteerEntry[];
  /** Remove + return the oldest entry (settle drain). */
  shift(): SteerEntry | undefined;
}

export interface SteerBufferOptions {
  cap?: number;
  maxBytes?: number;
}

export function createSteerBuffer(instanceNonce: string, options: SteerBufferOptions = {}): SteerBuffer {
  const cap = options.cap ?? FOLLOWUP_QUEUE_CAP;
  const maxBytes = options.maxBytes ?? FOLLOWUP_BUFFER_MAX_BYTES;
  let entries: SteerEntry[] = [];
  let seq = 0;

  const totalBytes = (): number => entries.reduce((sum, entry) => sum + entryBytes(entry), 0);

  return {
    get length() {
      return entries.length;
    },
    entries: () => [...entries],
    totalBytes,
    views: () =>
      entries.map((entry) => ({ id: entry.id, text: entry.text, imageCount: entry.images?.length ?? 0 })),

    push(entry): AdmitResult {
      if (entries.length >= cap) {
        return {
          ok: false,
          reason: "cap",
          message: `Steer queue is full (${cap} entries). Cancel a queued steer and try again.`,
        };
      }
      if (totalBytes() + entryBytes(entry) > maxBytes) {
        return {
          ok: false,
          reason: "bytes",
          message: `Steer queue byte ceiling exceeded (${maxBytes} bytes). Cancel a queued steer and try again.`,
        };
      }
      seq += 1;
      const id = `${instanceNonce}:${seq}`;
      entries.push({ ...entry, id });
      return { ok: true, id };
    },

    removeById(id: string): boolean {
      if (typeof id !== "string") return false;
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      entries.splice(index, 1);
      return true;
    },

    clear(): boolean {
      if (entries.length === 0) return false;
      entries = [];
      return true;
    },

    take(mode: SteeringMode): SteerEntry[] {
      if (entries.length === 0) return [];
      const count = mode === "all" ? entries.length : 1;
      return entries.splice(0, count);
    },

    shift: () => entries.shift(),
  };
}

/** Transport sinks for `admitSteer` (owned by `bridge.ts`). */
export interface SteerAdmissionSinks {
  sendCommandFeedback: (command: string, message: string) => void;
  emitQueueUpdate: () => void;
}

/**
 * Admit one streaming steer: validate its images with the follow-up path,
 * push it (whole-entry refusal on cap / byte ceiling), report refusals and
 * dropped attachments as `command_feedback` for `send_prompt`, and emit
 * `queue_update` when admitted. Returns whether the steer was held.
 * See change: bridge-owned-cancellable-steer (D6).
 */
export function admitSteer(
  buffer: SteerBuffer,
  input: { text: string; images?: unknown; promptId?: string },
  sinks: SteerAdmissionSinks,
): boolean {
  const { valid, dropped } = validateImages(input.images);
  const admitted = buffer.push({
    text: input.text,
    ...(valid.length > 0 ? { images: valid } : {}),
    ...(input.promptId ? { promptId: input.promptId } : {}),
  });
  if (!admitted.ok) {
    console.warn("[dashboard] steer buffer refused entry:", admitted.message);
    sinks.sendCommandFeedback("send_prompt", admitted.message);
    return false;
  }
  // Reported only once held: a refused entry's attachments are moot.
  if (dropped.length > 0) {
    sinks.sendCommandFeedback("send_prompt", `${dropped.length} attachment(s) dropped: ${dropped.join("; ")}`);
  }
  sinks.emitQueueUpdate();
  return true;
}
