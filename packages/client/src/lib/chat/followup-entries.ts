/**
 * Tolerant read of `Session.pendingQueues.followUp` (design D2b).
 *
 * The wire shape changed from `string[]` to `{ text, imageCount }[]`, and the
 * rollout is deliberately CLIENT-FIRST (design Migration Plan): this bundle is
 * serving BEFORE any extension emits the new shape. In that window a
 * not-yet-reloaded extension still sends legacy `string[]`, which the new
 * `QueuePanel` reads as `entry?.text` on a string — `undefined` — and renders
 * as an EMPTY chip, silently hiding a queued prompt. That is the skew this
 * closes; a stale TAB cannot be helped from here, since the old bundle has no
 * normaliser at all.
 *
 * Normalise ONCE, here, at the boundary where the session state reaches the
 * queue surface, so every downstream consumer sees exactly one shape.
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
      // Only a positive SAFE INTEGER is a count. A fractional or infinite
      // value from a malformed entry would render as "1.5" / "Infinity" on
      // the chip.
      imageCount:
        typeof e.imageCount === "number" &&
        Number.isSafeInteger(e.imageCount) &&
        e.imageCount > 0
          ? e.imageCount
          : 0,
    };
  }
  return { text: "", imageCount: 0 };
}

/** Normalise a whole `pendingQueues.followUp` array. */
export function normalizeFollowUpEntries(entries: unknown): FollowUpEntryView[] {
  if (!Array.isArray(entries)) return [];
  return entries.map(normalizeFollowUpEntry);
}
