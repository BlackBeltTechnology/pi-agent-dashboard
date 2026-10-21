/**
 * Queue lane adapter for the composer dock.
 *
 * `buildQueueLane` turns the session's normalised follow-up entries into a
 * `DockLane`: the header names the count and that follow-ups are delivered when
 * the agent finishes the turn, with Clear all from two entries on; the body is
 * the existing follow-up cycler (`QueuePanel` in `embedded` mode), unchanged.
 * Steering stays inline in the transcript. No lane for an empty queue.
 *
 * See change: add-composer-dock (task 6.1; design D13).
 */
import type { FollowUpEntryView } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCloseCircleOutline, mdiPlaylistPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t } from "../../lib/i18n/i18n.js";
import { QueuePanel } from "../session/QueuePanel.js";
import { type DockLane, dockLaneLabel } from "./composer-dock-model.js";

export interface QueueLaneInput {
  /** `normalizeFollowUpEntries(session.pendingQueues?.followUp)`. */
  followUp: readonly FollowUpEntryView[];
  onEdit?: (index: number, text: string) => void;
  onRemove?: (index: number) => void;
  onPromote?: (index: number) => void;
  /** `clear_followup_entries { sessionId, indices: "all" }` (App's `clearFollowUpEntries("all")`). */
  onClearAll?: () => void;
}

export function buildQueueLane({ followUp, onEdit, onRemove, onPromote, onClearAll }: QueueLaneInput): DockLane | null {
  const count = followUp.length;
  if (count === 0) return null;
  const title =
    count === 1
      ? t("dock.queue.titleOne", { count }, "{count} queued follow-up")
      : t("dock.queue.titleOther", { count }, "{count} queued follow-ups");
  const clearLabel = t("session.clearAllFollowUpEntries", undefined, "Clear all follow-up entries");
  return {
    key: "queue",
    label: dockLaneLabel("queue"),
    icon: <Icon path={mdiPlaylistPlus} size={0.7} />,
    title,
    meta: t("dock.queue.meta", undefined, "delivered when the agent finishes the turn"),
    summary: count,
    summaryText: title,
    expandable: true,
    announce: title,
    actions:
      count >= 2 && onClearAll ? (
        <button
          type="button"
          data-testid="queue-followup-clear-all"
          onClick={onClearAll}
          aria-label={clearLabel}
          title={clearLabel}
          className="focus-ring inline-flex min-h-6 min-w-6 items-center gap-1 rounded px-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] max-md:min-h-11 max-md:min-w-11 max-md:justify-center"
        >
          <Icon path={mdiCloseCircleOutline} size={0.6} aria-hidden="true" />
          {t("dock.queue.clearAll", undefined, "Clear all")}
        </button>
      ) : undefined,
    renderBody: () => (
      <QueuePanel embedded followUp={[...followUp]} onEdit={onEdit} onRemove={onRemove} onPromote={onPromote} />
    ),
  };
}
