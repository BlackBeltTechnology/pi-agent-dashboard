/**
 * Lightweight row for an archived session inside a folder's `Archive (N)`
 * fold or an `Archive matches` search section.
 *
 * NOT a SessionCard: no drag grip, no shadow, no live-status machinery —
 * just name + ended date + restore/delete actions. The row's session is
 * NEVER added to the live `sessions` Map; clicking opens it read-only
 * (`/session/<id>?archived=1`, transcript loaded on demand server-side).
 *
 * See change: archive-sessions-lazy-load.
 */
import { Icon } from "@mdi/react";
import { mdiDeleteOutline, mdiRestore } from "@mdi/js";
import { useState } from "react";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { t as i18nT, useI18n } from "../../lib/i18n/i18n.js";
import { deleteArchivedSession } from "../../lib/api/archived-sessions-api.js";

interface Props {
  item: ArchivedSessionSummary;
  onRestore: (id: string) => void;
  /** Called after a successful DELETE so the caller can drop cached rows. */
  onDeleted?: (id: string) => void;
  onOpen: (id: string) => void;
}

function formatEnded(at: number): string {
  return new Date(at).toLocaleDateString();
}

export function ArchivedSessionRow({ item, onRestore, onDeleted, onOpen }: Props) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const displayName = item.name || item.firstMessage || item.cwd;

  return (
    <>
      <div
        // Read-only open on row click; action buttons stopPropagation.
        onClick={() => onOpen(item.id)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-dashed border-[var(--border-secondary)] bg-[var(--bg-tertiary)] opacity-[0.62] hover:opacity-100 hover:border-solid cursor-pointer select-none transition-opacity"
        data-testid="archived-session-row"
        data-archived-id={item.id}
        title={displayName}
      >
        <span
          className="flex-shrink-0 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[9px] px-1.5 py-px text-[var(--text-tertiary)] uppercase tracking-wide"
        >
          {t("session.archived", undefined, "archived")}
        </span>
        <span className="text-xs text-[var(--text-secondary)] truncate flex-1">{displayName}</span>
        <span className="text-[10px] text-[var(--text-faint)] flex-shrink-0">{formatEnded(item.endedAt)}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onRestore(item.id); }}
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-green)] p-0.5 flex-shrink-0"
          title={t("session.restoreSession", undefined, "Restore session")}
          aria-label={t("session.restoreSession", undefined, "Restore session")}
          data-testid="session-unarchive-btn"
        >
          <Icon path={mdiRestore} size={0.5} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmOpen(true); }}
          disabled={deleting}
          className="text-[var(--text-tertiary)] hover:text-[var(--accent-red)] p-0.5 flex-shrink-0 disabled:cursor-default"
          title={t("session.deleteArchivedTitle", undefined, "Delete archived session?")}
          aria-label={t("session.deleteArchivedTitle", undefined, "Delete archived session?")}
          data-testid="archived-delete-btn"
        >
          <Icon path={mdiDeleteOutline} size={0.5} />
        </button>
      </div>
      {confirmOpen && (
        <Confirm
          open
          onClose={() => setConfirmOpen(false)}
          title={t("session.deleteArchivedTitle", undefined, "Delete archived session?")}
          message={t(
            "session.deleteArchivedMessage",
            undefined,
            "Deletes this session's transcript and metadata permanently. This cannot be undone.",
          )}
          intent="danger"
          confirmLabel={t("common.delete", undefined, "Delete")}
          onConfirm={() => {
            setDeleting(true);
            deleteArchivedSession(item.id)
              .then(() => {
                setConfirmOpen(false);
                onDeleted?.(item.id);
              })
              .catch(() => setDeleting(false));
          }}
          testId="archived-delete-confirm"
        />
      )}
    </>
  );
}
