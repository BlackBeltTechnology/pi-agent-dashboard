/**
 * Class strings shared by every pending-queue control, so the follow-up queue
 * (`QueuePanel`, `QueueLane`) and the pending steer bubbles (`PendingSteerCard`)
 * render the same remove ✕, image-count badge and `Clear all` button.
 * See change: bridge-owned-cancellable-steer (D9).
 */

/** Per-entry remove ✕ (w-6 h-6, red on hover). */
export const QUEUE_REMOVE_BUTTON_CLASS =
  "inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-red-text)] hover:bg-[var(--bg-hover)] transition-colors";

/** Attached-image count badge. */
export const QUEUE_ATTACHMENTS_CLASS = "inline-flex items-center gap-1 self-start text-[10px] text-[var(--text-tertiary)]";

/** Bulk `Clear all` (44px touch target below md). */
export const QUEUE_CLEAR_ALL_CLASS =
  "focus-ring inline-flex min-h-6 min-w-6 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:min-w-11 max-md:justify-center";
