/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: Initialize | Clean up broken
 * Terminals + Editor removed — that pane is reachable from the Directory home
 * page and ChatView. See change: compact-folder-header-actions.
 * Directory Settings moved into the folder actions menu; with it gone the bar
 * can hold nothing at all, so it renders NOTHING rather than an empty row.
 * See change: add-folder-actions-menu (3.6, 3.8).
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { mdiBroom } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useInitStatus } from "../../hooks/useInitStatus.js";
import { useInitRun } from "../../lib/git/worktree-init-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { ProjectInitButton, shouldShowProjectInit } from "../packages/ProjectInitButton.js";
import { shouldShowWorktreeInitButton, WorktreeInitButton } from "../worktree/WorktreeInitButton.js";

interface Props {
  cwd: string;
  /**
   * Number of ended sessions in this folder whose `cwdMissing === true`.
   * Drives the visibility + label of the `Clean up broken (N)` button.
   * 0 / undefined hides the button. See change: add-worktree-lifecycle-actions.
   */
  brokenSessionCount?: number;
  /** Called when the user confirms cleaning up. Fires hide for each broken session. */
  onCleanUpBroken?: () => void;
  /**
   * Called when an unconfigured directory's "Set up project" button is clicked.
   * Routed to spawning an interactive project-init session in `cwd`.
   * See change: project-init-skill-and-profiles, distinguish-initialize-actions.
   */
  onInitializeProject?: (cwd: string) => void;
}

export function FolderActionBar({
  cwd,
  brokenSessionCount,
  onCleanUpBroken,
  onInitializeProject,
}: Props) {
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);
  // Single shared init-status probe feeds both init buttons (avoids a double
  // fetch per row). See change: distinguish-initialize-actions.
  const { status: initStatus, refetch: refetchInitStatus } = useInitStatus(cwd);
  // A live/terminal run keeps WorktreeInitButton on screen as a chip even when
  // the gate has flipped, so it counts towards "the bar has something".
  const initRun = useInitRun(cwd);

  // Nothing to show → render nothing. The predicates are imported from the two
  // init buttons so this cannot drift from what they actually render.
  const hasContent =
    showCleanUp ||
    shouldShowProjectInit(initStatus, onInitializeProject) ||
    !!initRun ||
    shouldShowWorktreeInitButton(initStatus);
  if (!hasContent) return null;

  return (
    <div className="flex items-center gap-1">
      {/* Two monomorphic init controls, each self-gating on the shared probe:
          - ProjectInitButton: indigo "Set up project" scaffold, state ① only.
          - WorktreeInitButton: amber "Initialize" hook runner, state ② only.
          State ③ (configured, no hook) renders neither. */}
      <ProjectInitButton cwd={cwd} status={initStatus} onInitializeProject={onInitializeProject} />
      <WorktreeInitButton cwd={cwd} status={initStatus} onStatusChange={refetchInitStatus} />

      {showCleanUp && (
        <button
          type="button"
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
