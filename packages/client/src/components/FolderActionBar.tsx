/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: Terminals(N) | Editor | Zed | Clean up broken | Pi Resources
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";
import {
  mdiAlertCircleOutline,
  mdiBroom,
  mdiCircleSmall,
  mdiCodeBraces,
  mdiConsoleLine,
  mdiOpenInNew,
  mdiToyBrickOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import type { DetectedEditor } from "../lib/editor-api.js";
import { t as i18nT } from "../lib/i18n";
import { WorktreeInitButton } from "./WorktreeInitButton.js";

interface Props {
  cwd: string;
  terminalCount: number;
  editorStatus?: { id: string; status: EditorInstanceStatus } | null;
  editorAvailable?: boolean; // Whether code-server binary is detected
  nativeEditors: DetectedEditor[];
  /**
   * Number of ended sessions in this folder whose `cwdMissing === true`.
   * Drives the visibility + label of the `Clean up broken (N)` button.
   * 0 / undefined hides the button. See change: add-worktree-lifecycle-actions.
   */
  brokenSessionCount?: number;
  /** Called when the user confirms cleaning up. Fires hide for each broken session. */
  onCleanUpBroken?: () => void;
  onOpenTerminals: () => void;
  onOpenEditor: () => void;
  onOpenNativeEditor: (editorId: string) => void;
  onOpenPiResources: () => void;
}

// Icon map for native editors
const editorIcons: Record<string, string> = {
  zed: "Z",
};

export function FolderActionBar({
  cwd,
  terminalCount,
  editorStatus,
  editorAvailable = true,
  nativeEditors,
  brokenSessionCount,
  onCleanUpBroken,
  onOpenTerminals,
  onOpenEditor,
  onOpenNativeEditor,
  onOpenPiResources,
}: Props) {
  // Filter out vscode/code from native editors (served via EditorView)
  const filteredNativeEditors = nativeEditors.filter((e) => e.id !== "vscode" && e.id !== "code");
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Initialize (shown iff this checkout declares a hook + gate says needsInit) */}
      <WorktreeInitButton cwd={cwd} />

      {/* Terminals(N) */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70"
        title={i18nT("auto.open_terminals_view", undefined, "Open terminals view")}
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiConsoleLine} size={0.5} />
          {i18nT("auto.terminals", undefined, "Terminals(")}{terminalCount})
        </span>
      </button>

      {/* Editor */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          editorStatus?.status === "ready"
            ? "border-green-500/50 text-green-400 bg-green-500/5"
            : editorStatus?.status === "starting"
            ? "border-blue-500/50 text-blue-400 bg-blue-500/5"
            : editorAvailable === false
            ? "border-yellow-500/50 text-[var(--text-secondary)]"
            : "text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300 hover:border-blue-500/70"
        }`}
        title={editorAvailable === false ? "code-server not found — click to see install guide" : editorStatus?.status === "ready" ? "Editor running — click to open" : editorStatus?.status === "starting" ? "Editor starting..." : "Open VS Code editor"}
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiCodeBraces} size={0.5} />
          {i18nT("auto.editor", undefined, "Editor")}
          {editorAvailable === false && (
            <Icon path={mdiAlertCircleOutline} size={0.4} className="text-yellow-400" />
          )}
          {editorStatus?.status === "ready" && (
            <Icon path={mdiCircleSmall} size={0.6} className="text-green-500" />
          )}
          {editorStatus?.status === "starting" && (
            <Icon path={mdiCircleSmall} size={0.6} className="text-blue-400 animate-pulse" />
          )}
        </span>
      </button>

      {/* Native editors (e.g., Zed) — filtered to exclude vscode */}
      {filteredNativeEditors.map((editor) => (
        <button
          key={editor.id}
          onClick={(e) => { e.stopPropagation(); onOpenNativeEditor(editor.id); }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50"
          title={`Open in ${editor.name}`}
        >
          <span className="inline-flex items-center gap-0.5">
            {editorIcons[editor.id] ? (
              <span className="text-[10px] font-bold">{editorIcons[editor.id]}</span>
            ) : (
              <Icon path={mdiOpenInNew} size={0.5} />
            )}
            {editor.name}
          </span>
        </button>
      ))}

      {showCleanUp && (
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmCleanUpOpen(true); }}
          data-testid="folder-cleanup-broken-btn"
          className="text-[10px] px-1.5 py-0.5 rounded border border-red-500/40 text-red-300 hover:bg-red-500/10"
          title={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists`}
        >
          <span className="inline-flex items-center gap-0.5">
            <Icon path={mdiBroom} size={0.5} /> {i18nT("auto.clean_up_broken", undefined, "Clean up broken (")}{brokenSessionCount})
          </span>
        </button>
      )}
      {confirmCleanUpOpen && (
        <Confirm
          open
          testId="cleanup-broken-confirm"
          title={i18nT("auto.hide_broken_sessions", undefined, "Hide broken sessions?")}
          message={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists?`}
          confirmLabel="Hide"
          onConfirm={() => { setConfirmCleanUpOpen(false); onCleanUpBroken?.(); }}
          onClose={() => setConfirmCleanUpOpen(false)}
        />
      )}

      {/* Pi Resources — right-aligned */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
        className="focus-ring ml-auto text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/50"
        title={i18nT("auto.pi_resources", undefined, "Pi Resources")}
        aria-label={i18nT("auto.pi_resources", undefined, "Pi Resources")}
      >
        <Icon path={mdiToyBrickOutline} size={0.5} />
      </button>
    </div>
  );
}
