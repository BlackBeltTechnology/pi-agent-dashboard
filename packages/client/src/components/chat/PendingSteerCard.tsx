/**
 * Pending steer bubble: a steer the bridge still holds (not yet handed to pi).
 * Carries the follow-up controls verbatim — per-entry ✕ in the body row, an
 * image-count badge, and (via `PendingSteerClearAll`) a bulk `Clear all` from
 * two entries on. No confirmation: a held steer is cheap to retype.
 *
 * A legacy bridge sends plain-string steers with no id; those normalise to
 * entries without an `id` and render without a cancel control.
 *
 * Layout per accepted mock `mockups/2026-11-12-steer-cancel-images` (minus the
 * dropped "Delivering" step — the bubble disappears at hand-off).
 * See change: bridge-owned-cancellable-steer (D9).
 */
import type { SteerEntryView } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiClose, mdiCloseCircleOutline, mdiImageMultipleOutline, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";
import { QUEUE_ATTACHMENTS_CLASS, QUEUE_CLEAR_ALL_CLASS, QUEUE_REMOVE_BUTTON_CLASS } from "./queue-control-classes.js";

/** A pending steer as rendered: `id` absent ⇔ legacy string entry (not cancellable). */
export interface PendingSteer {
  id?: string;
  /** Stable React / arrival key: the id, or a positional key for legacy strings. */
  key: string;
  text: string;
  imageCount: number;
}

/** Normalise the wire `steering` array (`SteerEntryView | string`) for rendering. */
export function normalizeSteering(steering: readonly (SteerEntryView | string)[] | undefined): PendingSteer[] {
  if (!steering) return [];
  return steering.map((entry, idx) =>
    typeof entry === "string"
      ? { key: `legacy:${idx}`, text: entry, imageCount: 0 }
      : { id: entry.id, key: entry.id, text: entry.text, imageCount: entry.imageCount ?? 0 },
  );
}

// Theme tokens (not raw palette): `--tint-blue-*` is the blue pill/bubble role.
const BUBBLE_CLASS =
  "relative bg-[var(--tint-blue-bg)] border border-[var(--tint-blue-border)] border-l-2 border-l-[var(--accent-blue)] rounded-xl shadow-md px-4 py-2";

export function PendingSteerCard({ steer, maxWidthClass, onCancel }: {
  steer: PendingSteer;
  /** Responsive bubble width (`max-w-[80%]` desktop / `max-w-[95%]` mobile). */
  maxWidthClass: string;
  onCancel?: (id: string) => void;
}) {
  const cancellable = steer.id !== undefined && onCancel !== undefined;
  return (
    <div data-testid="pending-steer-bubble" className={`${BUBBLE_CLASS} ${maxWidthClass}`}>
      <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider text-[var(--accent-blue-text)] font-medium">
        <Icon path={mdiLoading} size={0.45} className="animate-spin" />
        {i18nT("session.steering", undefined, "Steering")}
      </div>
      <div className="flex items-start gap-1.5">
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <MarkdownContent content={steer.text} />
          {steer.imageCount > 0 && (
            <span
              data-testid="pending-steer-attachments"
              title={i18nT("session.attachedImages", undefined, "Attached images")}
              className={QUEUE_ATTACHMENTS_CLASS}
            >
              <Icon path={mdiImageMultipleOutline} size={0.55} />
              {steer.imageCount}
            </span>
          )}
        </div>
        {cancellable && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              data-testid={`pending-steer-cancel-${steer.id}`}
              onClick={() => onCancel(steer.id as string)}
              aria-label={i18nT("session.cancelSteer", undefined, "Cancel steer")}
              title={i18nT("common.cancel", undefined, "Cancel")}
              className={QUEUE_REMOVE_BUTTON_CLASS}
            >
              <Icon path={mdiClose} size={0.65} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Bulk cancel below the steer stack; the caller renders it from two entries on. */
export function PendingSteerClearAll({ onClear }: { onClear: () => void }) {
  const label = i18nT("session.clearAllSteering", undefined, "Clear all steering entries");
  return (
    <div className="flex justify-end -mt-2 mb-2">
      <button
        type="button"
        data-testid="pending-steer-clear-all"
        onClick={onClear}
        aria-label={label}
        title={label}
        className={QUEUE_CLEAR_ALL_CLASS}
      >
        <Icon path={mdiCloseCircleOutline} size={0.6} aria-hidden="true" />
        {i18nT("dock.queue.clearAll", undefined, "Clear all")}
      </button>
    </div>
  );
}
