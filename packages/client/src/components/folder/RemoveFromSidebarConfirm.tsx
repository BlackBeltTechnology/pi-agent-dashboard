import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { t } from "../../lib/i18n/i18n.js";

interface RemoveFromSidebarConfirmProps {
  /** Folder being removed (display path). */
  cwd: string;
  /** Every live session in the folder's group, hidden ones included. */
  sessions: DashboardSession[];
  onConfirm: () => void;
  onClose: () => void;
}

function sessionLabel(s: DashboardSession): string {
  return s.name ?? s.firstMessage?.slice(0, 40) ?? s.id.slice(0, 8);
}

/**
 * Confirm dialog for "Remove from sidebar" when the folder still has live
 * sessions: lists all of them (height-capped, scrollable), focus starts on
 * Cancel because confirming ends them.
 * See change: sidebar-folder-ux.
 */
export function RemoveFromSidebarConfirm({ cwd, sessions, onConfirm, onClose }: RemoveFromSidebarConfirmProps) {
  return (
    <Confirm
      open
      testId="remove-from-sidebar-confirm"
      intent="danger"
      defaultFocus="cancel"
      title={t("sessionList.removeFromSidebarTitle", undefined, "Remove folder from sidebar?")}
      message={t(
        "sessionList.removeFromSidebarMessage",
        { path: cwd },
        `${cwd} has live sessions. Removing it ends them first.`,
      )}
      confirmLabel={t("sessionList.removeFromSidebarConfirm", undefined, "End sessions & remove")}
      onConfirm={onConfirm}
      onClose={onClose}
      body={
        <ul
          data-testid="remove-from-sidebar-sessions"
          className="text-xs text-[var(--text-secondary)] list-disc list-inside max-h-32 overflow-y-auto"
        >
          {sessions.map((s) => (
            <li key={s.id} className="truncate" data-testid={`remove-from-sidebar-session-${s.id}`}>
              {sessionLabel(s)}
            </li>
          ))}
        </ul>
      }
    />
  );
}
