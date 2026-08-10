/**
 * Follow-up queue panel — bridge-owned mutation surface.
 *
 * The bridge owns `bridgeFollowUp` (pi 0.76.0 ExtensionAPI exposes no
 * queue-mutation primitives). Dashboard-queued follow-ups never reach pi
 * until the drain loop ships them on `agent_end` as fresh-turn sends.
 *
 * Entry-chip controls:
 *   [✎]  inline edit       (textarea, Cmd/Ctrl+Enter submits, Esc cancels)
 *   [⇧]  promote to head   (disabled when idx === 0)
 *   [✕]  remove            (confirm only when entry > 50 chars)
 *
 * Plus a panel-header "Clear all follow-up" button when length > 1.
 *
 * Steer is permanently pi-owned + display-only — steer drains too fast at
 * turn_end for mutation UI to matter. Steer chips render in ChatView as
 * inline ghost user-message bubbles, never here.
 *
 * See change: rework-mid-turn-prompt-queue.
 */

import {
  mdiArrowCollapseUp,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiCloseCircleOutline,
  mdiPencilOutline,
} from "@mdi/js";
import Icon from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  /** The follow-up queue entries from `Session.pendingQueues.followUp`. */
  followUp: string[];
  /** Dispatch `edit_followup_entry { index, text }` — mutates bridge buffer only. */
  onEdit?: (index: number, text: string) => void;
  /** Dispatch `remove_followup_entry { index }` — mutates bridge buffer only. */
  onRemove?: (index: number) => void;
  /** Dispatch `promote_followup_entry { index }` — mutates bridge buffer only. */
  onPromote?: (index: number) => void;
  /** Dispatch `clear_followup_entries { indices: "all" }`. */
  onClearAll?: () => void;
}

export function QueuePanel({ followUp, onEdit, onRemove, onPromote, onClearAll }: Props) {
  const hasFollowUp = followUp.length > 0;
  if (!hasFollowUp) return null;

  return (
    <div
      data-testid="queue-panel"
      className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2 flex flex-col gap-2"
    >
      <FollowupCycler
        entries={followUp}
        onEdit={onEdit}
        onRemove={onRemove}
        onPromote={onPromote}
        onClearAll={onClearAll}
      />
    </div>
  );
}

function FollowupCycler({
  entries,
  onEdit,
  onRemove,
  onPromote,
  onClearAll,
}: {
  entries: string[];
  onEdit?: (index: number, text: string) => void;
  onRemove?: (index: number) => void;
  onPromote?: (index: number) => void;
  onClearAll?: () => void;
}) {
  // currentIndex tracks which entry is visible. Initial: last entry (so the
  // user sees what they most recently queued). Subsequent appends advance
  // to the new last; removals clamp.
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, entries.length - 1));
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const prevLenRef = useRef(entries.length);

  useEffect(() => {
    const len = entries.length;
    const prev = prevLenRef.current;
    prevLenRef.current = len;
    if (len === 0) {
      setCurrentIndex(0);
      setEditing(false);
      return;
    }
    if (len > prev) {
      setCurrentIndex(len - 1);
    } else if (currentIndex >= len) {
      setCurrentIndex(len - 1);
    }
  }, [entries.length, currentIndex]);

  const idx = Math.min(currentIndex, entries.length - 1);
  const text = entries[idx] ?? "";
  const total = entries.length;
  const canPrev = idx > 0;
  const canNext = idx < total - 1;

  const startEdit = () => {
    setEditText(text);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const submitEdit = () => {
    const trimmed = editText;
    setEditing(false);
    // Skip dispatch if unchanged — bridge would just emit a no-op queue_update.
    if (trimmed === text) return;
    onEdit?.(idx, trimmed);
  };

  const handleRemove = () => {
    // Confirmation only for entries > 50 chars (long entries are higher-cost to lose).
    if (text.length > 50) {
      if (typeof window !== "undefined" && !window.confirm("Remove this follow-up entry?")) return;
    }
    onRemove?.(idx);
  };

  return (
    <div
      data-testid="queue-panel-followup"
      className="rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)]/40 px-3 py-2"
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/80" aria-hidden />
          {i18nT("session.followUpDeliveredWhenTheAgent", undefined, "Follow-up — delivered when the agent finishes the turn")}
          {total > 1 && (
            <span data-testid="queue-followup-position" className="ml-1 text-[var(--text-secondary)]">
              {idx + 1} of {total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {total > 1 && (
            <>
              <button
                type="button"
                onClick={() => setCurrentIndex(idx - 1)}
                disabled={!canPrev || editing}
                data-testid="queue-followup-prev"
                aria-label={i18nT("session.previousFollowUpEntry", undefined, "Previous follow-up entry")}
                title={i18nT("common.previousEntry", undefined, "Previous entry")}
                className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <Icon path={mdiChevronUp} size={0.65} />
              </button>
              <button
                type="button"
                onClick={() => setCurrentIndex(idx + 1)}
                disabled={!canNext || editing}
                data-testid="queue-followup-next"
                aria-label={i18nT("session.nextFollowUpEntry", undefined, "Next follow-up entry")}
                title={i18nT("common.nextEntry", undefined, "Next entry")}
                className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <Icon path={mdiChevronDown} size={0.65} />
              </button>
              <button
                type="button"
                onClick={() => onClearAll?.()}
                disabled={editing}
                data-testid="queue-followup-clear-all"
                aria-label={i18nT("session.clearAllFollowUpEntries", undefined, "Clear all follow-up entries")}
                title={i18nT("session.clearAllFollowUp", undefined, "Clear all follow-up")}
                className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                <Icon path={mdiCloseCircleOutline} size={0.65} />
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            data-testid="queue-followup-editor"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitEdit();
              }
            }}
            autoFocus
            rows={Math.min(6, Math.max(2, editText.split("\n").length))}
            className="block w-full text-sm bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--border-focus)]"
          />
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
            <span>{i18nT("common.cmdCtrlEnterToSaveEsc", undefined, "Cmd/Ctrl+Enter to save, Esc to cancel")}</span>
            <button
              type="button"
              onClick={cancelEdit}
              className="ml-auto px-2 py-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button
              type="button"
              onClick={submitEdit}
              data-testid="queue-followup-editor-submit"
              className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30"
            >
              {i18nT("common.save2", undefined, "Save")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          <div
            data-testid="queue-chip-followup"
            className="flex-1 min-w-0 max-h-80 overflow-auto text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed"
          >
            {text}
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={startEdit}
              data-testid="queue-followup-edit"
              aria-label={i18nT("session.editFollowUpEntry", undefined, "Edit follow-up entry")}
              title={i18nT("common.edit", undefined, "Edit")}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Icon path={mdiPencilOutline} size={0.65} />
            </button>
            <button
              type="button"
              onClick={() => onPromote?.(idx)}
              disabled={idx === 0}
              data-testid="queue-followup-promote"
              aria-label={i18nT("session.promoteFollowUpEntryToHead", undefined, "Promote follow-up entry to head")}
              title={idx === 0 ? "Already at head" : "Promote to head"}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Icon path={mdiArrowCollapseUp} size={0.65} />
            </button>
            <button
              type="button"
              onClick={handleRemove}
              data-testid="queue-followup-remove"
              aria-label={i18nT("session.removeFollowUpEntry", undefined, "Remove follow-up entry")}
              title={i18nT("common.remove2", undefined, "Remove")}
              className="inline-flex items-center justify-center w-6 h-6 rounded text-[var(--text-tertiary)] hover:text-red-400 hover:bg-[var(--bg-hover)] transition-colors"
            >
              <Icon path={mdiClose} size={0.65} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
