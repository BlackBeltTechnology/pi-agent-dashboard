/**
 * Unified action bar for folder groups in the sidebar.
 * Button: Clean up broken
 * Terminals + Editor removed — that pane is reachable from the Directory home
 * page and ChatView. See change: compact-folder-header-actions.
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { mdiBroom } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  /**
   * Number of ended sessions in this folder whose `cwdMissing === true`.
   * Drives the visibility + label of the `Clean up broken (N)` button.
   * 0 / undefined hides the button. See change: add-worktree-lifecycle-actions.
   */
  brokenSessionCount?: number;
  /** Called when the user confirms cleaning up. Fires hide for each broken session. */
  onCleanUpBroken?: () => void;
}

export function FolderActionBar({
  brokenSessionCount,
  onCleanUpBroken,
}: Props) {
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1">
      {showCleanUp && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmCleanUpOpen(true); }}
          data-testid="folder-cleanup-broken-btn"
          className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
          title={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists`}
        >
          <span className="inline-flex items-center gap-0.5">
            <Icon path={mdiBroom} size={0.5} /> {i18nT("common.cleanUpBroken", undefined, "Clean up broken (")}{brokenSessionCount})
          </span>
        </button>
      )}
      {confirmCleanUpOpen && (
        <Confirm
          open
          testId="cleanup-broken-confirm"
          title={i18nT("session.hideBrokenSessions", undefined, "Hide broken sessions?")}
          message={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists?`}
          confirmLabel="Hide"
          onConfirm={() => { setConfirmCleanUpOpen(false); onCleanUpBroken?.(); }}
          onClose={() => setConfirmCleanUpOpen(false)}
        />
      )}

    </div>
  );
}
