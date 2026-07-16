/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: Terminals(N) | Editor | Clean up broken | Directory Settings
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import {
  mdiBroom,
  mdiCodeBraces,
  mdiCog,
  mdiConsoleLine,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useInitStatus } from "../hooks/useInitStatus.js";
import { t as i18nT } from "../lib/i18n";
import { ProjectInitButton } from "./ProjectInitButton.js";
import { WorktreeInitButton } from "./WorktreeInitButton.js";

interface Props {
  cwd: string;
  terminalCount: number;
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
  onOpenTerminals: () => void;
  onOpenEditor: () => void;
  onOpenPiResources: () => void;
}

export function FolderActionBar({
  cwd,
  terminalCount,
  brokenSessionCount,
  onCleanUpBroken,
  onInitializeProject,
  onOpenTerminals,
  onOpenEditor,
  onOpenPiResources,
}: Props) {
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);
  // Single shared init-status probe feeds both init buttons (avoids a double
  // fetch per row). See change: distinguish-initialize-actions.
  const { status: initStatus, refetch: refetchInitStatus } = useInitStatus(cwd);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Two monomorphic init controls, each self-gating on the shared probe:
          - ProjectInitButton: indigo "Set up project" scaffold, state ① only.
          - WorktreeInitButton: amber "Initialize" hook runner, state ② only.
          State ③ (configured, no hook) renders neither. */}
      <ProjectInitButton cwd={cwd} status={initStatus} onInitializeProject={onInitializeProject} />
      <WorktreeInitButton cwd={cwd} status={initStatus} onStatusChange={refetchInitStatus} />

      {/* Terminals(N) */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70"
        title={i18nT("terminal.openTerminalsView", undefined, "Open terminals view")}
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiConsoleLine} size={0.5} />
          {i18nT("terminal.terminals", undefined, "Terminals(")}{terminalCount})
        </span>
      </button>

      {/* Editor — opens the internal Monaco pane rooted at this folder. */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300 hover:border-blue-500/70"
        title="Open editor"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiCodeBraces} size={0.5} />
          {i18nT("editor.editor", undefined, "Editor")}
        </span>
      </button>

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

      {/* Directory Settings — right-aligned. See change: directory-settings-page-and-scoped-md-editing. */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
        className="focus-ring ml-auto text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/50"
        title={i18nT("folders.directorySettings", undefined, "Directory Settings")}
        aria-label={i18nT("folders.directorySettings", undefined, "Directory Settings")}
      >
        <Icon path={mdiCog} size={0.5} />
      </button>
    </div>
  );
}
