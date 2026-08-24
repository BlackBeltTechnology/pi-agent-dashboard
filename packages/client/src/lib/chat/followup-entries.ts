/**
 * Tolerant read of `Session.pendingQueues.followUp` (design D2b).
 *
 * The wire shape changed from `string[]` to `{ text, imageCount }[]`. The
 * dashboard ships as one version, but a browser tab left open across an
 * extension reload is a realistic skew source, and an un-normalised object
 * would render as `[object Object]` in every chip. Normalise ONCE, here, at
 * the boundary where the session state reaches the queue surface, so every
 * downstream consumer sees exactly one shape.
 *
 * Delete the string branch one release after `fix-bridge-followup-image-drop`
 * ships.
 */

import type { FollowUpEntryView } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Coerce a legacy `string` or a current `{ text, imageCount }` into the latter. */
export function normalizeFollowUpEntry(entry: unknown): FollowUpEntryView {
  if (typeof entry === "string") return { text: entry, imageCount: 0 };
  if (entry && typeof entry === "object") {
    const e = entry as { text?: unknown; imageCount?: unknown };
    return {
      text: typeof e.text === "string" ? e.text : "",
      imageCount: typeof e.imageCount === "number" && e.imageCount > 0 ? e.imageCount : 0,
    };
  }
  return { text: "", imageCount: 0 };
}

/** Normalise a whole `pendingQueues.followUp` array. */
export function normalizeFollowUpEntries(entries: unknown): FollowUpEntryView[] {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeFollowUpEntry);
}
