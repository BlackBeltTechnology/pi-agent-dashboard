/**
 * The bridge-owned follow-up buffer: the authoritative store for
 * dashboard-originated follow-up prompts while the agent streams. Pi never sees
 * an entry until `drainFollowupQueue()` ships it on `agent_end`.
 *
 * Extracted from `bridge.ts` so the admission arithmetic is reachable by tests
 * without instantiating the whole extension, and so the byte ceiling can be
 * INJECTED (design D3b) — boundary tests drive the real comparison against a
 * 1 KiB ceiling instead of allocating tens of megabytes of base64 per case.
 *
 * Two bounds, independent of each other:
 *   - `cap` (20 entries)          — queue depth
 *   - `maxBytes` (32 MiB)         — aggregate memory hold
 *
 * The total is RECOMPUTED from live entries at every admission check, never
 * accumulated (design D3). The buffer is mutated from ~10 sites; a single
 * forgotten decrement would mis-enforce the ceiling forever with no visible
 * symptom. Recomputation over <= 20 entries is trivially cheap and makes drift
 * structurally impossible — abort, session reset and any future mutation site
 * release bytes correctly without knowing the budget exists.
 *
 * Enforcement is REFUSAL, not eviction: silently discarding a previously
 * accepted prompt is the same defect class this module exists to fix. An entry
 * is never partially admitted — images are never stripped to make it fit.
 *
 * This module holds NO transport: it returns decisions, and `bridge.ts` owns
 * `queue_update` / `command_feedback` emission.
 *
 * See change: fix-bridge-followup-image-drop (design D1, D3, D3b, D3c).
 */

import { imageBlockData } from "@blackbelt-technology/pi-dashboard-shared/image-block.js";
import type { FollowUpEntryView, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** One buffered follow-up: prompt text plus the attachments sent with it. */
export interface FollowUpEntry {
  text: string;
  images?: ImageContent[];
}

/** Soft cap on follow-up buffer depth. See change: rework-mid-turn-prompt-queue. */
export const FOLLOWUP_QUEUE_CAP = 20;

/**
 * Aggregate byte ceiling on the buffer.
 *
 * Basis (design D3): the send path applies no downscale
 * (`useImagePaste.ts` admits up to `MAX_IMAGE_SIZE = 10 MB`) and there is no
 * per-send image-count cap anywhere, so the pre-change worst case was
 * `20 entries x N images x 10 MB` — unbounded in N. 32 MiB holds roughly 10–30
 * typical pasted screenshots, or three maximum-size images.
 */
export const FOLLOWUP_BUFFER_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Byte size of one entry: UTF-8 text plus the raw base64 bytes of every image.
 *
 * `Buffer.byteLength` (not `String.length`) because the latter counts UTF-16
 * code units and under-counts non-Latin-1 text. Image bytes are read through
 * `imageBlockData` (design D3c): a direct `.data` read is correct only for the
 * flat pi shape and sizes a nested Anthropic block at ZERO — an unbounded hold
 * that passes every ceiling check, which is exactly the exposure the ceiling
 * exists to close. `JSON.stringify` is never used: it would allocate a copy of
 * the megabyte payload just to measure it.
 */
export function entryBytes(entry: FollowUpEntry): number {
  let total = Buffer.byteLength(entry.text ?? "", "utf8");
  for (const image of entry.images ?? []) {
    total += imageBlockData(image)?.length ?? 0;
  }
  return total;
}

/** A refused admission carries the reason so the caller can surface it. */
type AdmitRefusal = { ok: false; reason: "cap" | "bytes"; message: string };
type AdmitResult = { ok: true } | AdmitRefusal;
type EditResult = { ok: true } | { ok: false; reason: "range" | "bytes"; message: string };

export interface FollowupBuffer {
  /** Snapshot of the current entries, for read-only inspection. */
  entries(): readonly FollowUpEntry[];
  readonly length: number;
  /** Sum of `entryBytes` over the entries actually present, recomputed on call. */
  totalBytes(): number;
  /** Wire projection: text + image COUNT. Bytes never cross the wire (design D2). */
  views(): FollowUpEntryView[];
  /** Append, subject to BOTH bounds. Whole-entry refusal; never strips images. */
  push(entry: FollowUpEntry): AdmitResult;
  /** Pop the head for the drain. */
  shift(): FollowUpEntry | undefined;
  /** Replace an entry's TEXT, preserving its images. Gated on the byte ceiling. */
  editText(index: number, text: string): EditResult;
  removeAt(index: number): boolean;
  /** Move `index` to the head, carrying its images. No-op at or below 0. */
  promote(index: number): boolean;
  clearAll(): boolean;
  clearIndices(indices: number[]): boolean;
  /** Drop everything without reporting mutation (session change / reset). */
  reset(): void;
  /** Index of the first entry whose text matches exactly, or -1. */
  indexOfText(text: string): number;
}

export interface FollowupBufferOptions {
  cap?: number;
  maxBytes?: number;
}

export function createFollowupBuffer(options: FollowupBufferOptions = {}): FollowupBuffer {
  const cap = options.cap ?? FOLLOWUP_QUEUE_CAP;
  const maxBytes = options.maxBytes ?? FOLLOWUP_BUFFER_MAX_BYTES;
  let entries: FollowUpEntry[] = [];

  const totalBytes = (): number => entries.reduce((sum, entry) => sum + entryBytes(entry), 0);

  return {
    // A COPY: the internal array must not be mutable through a read accessor,
    // or a caller could bypass every bound above.
    entries: () => [...entries],
    get length() {
      return entries.length;
    },
    totalBytes,
    views: () =>
      entries.map((entry) => ({ text: entry.text, imageCount: entry.images?.length ?? 0 })),

    push(entry: FollowUpEntry): AdmitResult {
      if (entries.length >= cap) {
        return {
          ok: false,
          reason: "cap",
          message: `Follow-up queue is full (${cap} entries). Remove a queued entry and try again.`,
        };
      }
      if (totalBytes() + entryBytes(entry) > maxBytes) {
        return {
          ok: false,
          reason: "bytes",
          message: `Follow-up queue byte ceiling exceeded (${maxBytes} bytes). Remove a queued entry and try again.`,
        };
      }
      entries.push(entry);
      return { ok: true };
    },

    shift: () => entries.shift(),

    editText(index: number, text: string): EditResult {
      if (typeof index !== "number" || index < 0 || index >= entries.length) {
        return { ok: false, reason: "range", message: "Index out of range" };
      }
      const current = entries[index];
      // Gate the edit too: the inline editor can grow text without bound, so
      // gating push alone would leave "bounded in bytes" false (design D3).
      const next: FollowUpEntry = { text, ...(current.images ? { images: current.images } : {}) };
      const projected = totalBytes() - entryBytes(current) + entryBytes(next);
      if (projected > maxBytes) {
        return {
          ok: false,
          reason: "bytes",
          message: `Follow-up queue byte ceiling exceeded (${maxBytes} bytes). Shorten the entry and try again.`,
        };
      }
      entries[index] = next;
      return { ok: true };
    },

    removeAt(index: number): boolean {
      if (typeof index !== "number" || index < 0 || index >= entries.length) return false;
      entries.splice(index, 1);
      return true;
    },

    promote(index: number): boolean {
      if (typeof index !== "number" || index <= 0 || index >= entries.length) return false;
      const [entry] = entries.splice(index, 1);
      entries.unshift(entry);
      return true;
    },

    clearAll(): boolean {
      if (entries.length === 0) return false;
      entries = [];
      return true;
    },

    clearIndices(indices: number[]): boolean {
      if (!Array.isArray(indices)) return false;
      // DEDUPE, and require whole numbers. A duplicate (`[0, 0]`) would splice
      // twice and take an entry the user never selected; a fractional index
      // passes a naive range check and `splice` silently truncates it.
      const unique = [
        ...new Set(
          indices.filter(
            (i): i is number => typeof i === "number" && Number.isInteger(i) && i >= 0,
          ),
        ),
      ];
      // Descending so earlier splices do not shift later indices.
      const sorted = unique.sort((a, b) => b - a);
      let mutated = false;
      for (const i of sorted) {
        if (i < entries.length) {
          entries.splice(i, 1);
          mutated = true;
        }
      }
      return mutated;
    },

    reset() {
      entries = [];
    },

    indexOfText: (text: string) => entries.findIndex((entry) => entry.text === text),
  };
}
