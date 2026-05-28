/**
 * Unified action bar for folder groups in the sidebar.
 * Buttons: +Session | Terminals(N) | Editor | Zed | Pi Resources
 */
import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiPlus,
  mdiConsoleLine,
  mdiCodeBraces,
  mdiToyBrickOutline,
  mdiOpenInNew,
  mdiAlertCircleOutline,
  mdiCircleSmall,
  mdiSourceBranchPlus,
  mdiBroom,
} from "@mdi/js";
import { ConfirmDialog } from "@blackbelt-technology/pi-dashboard-client-utils/ConfirmDialog";
import type { DetectedEditor } from "../lib/editor-api.js";
import type { EditorInstanceStatus } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";

interface Props {
  cwd: string;
  terminalCount: number;
  editorStatus?: { id: string; status: EditorInstanceStatus } | null;
  editorAvailable?: boolean; // Whether code-server binary is detected
  nativeEditors: DetectedEditor[];
  spawningDisabled?: boolean;
  /**
   * Whether the folder is detected as a git repository. When false, the
   * `+Worktree` button is hidden (no git ops apply). When undefined, the
   * caller hasn't probed yet — we hide the button defensively.
   * See change: add-worktree-spawn-dialog.
   */
  isGitRepo?: boolean;
  /**
   * UI preference: globally enable worktree spawn buttons. When false,
   * the `+Worktree` button hides regardless of git status. Required — the
   * parent (SessionList) reads `config.gitWorktreeEnabled ?? true` and
   * passes it explicitly. See change: openspec-worktree-spawn-button.
   */
  gitWorktreeEnabled: boolean;
  /**
   * Number of ended sessions in this folder whose `cwdMissing === true`.
   * Drives the visibility + label of the `Clean up broken (N)` button.
   * 0 / undefined hides the button. See change: add-worktree-lifecycle-actions.
   */
  brokenSessionCount?: number;
  /** Called when the user confirms cleaning up. Fires hide for each broken session. */
  onCleanUpBroken?: () => void;
  onSpawnSession: () => void;
  onOpenTerminals: () => void;
  onOpenEditor: () => void;
  onOpenNativeEditor: (editorId: string) => void;
  onOpenPiResources: () => void;
  /** Open the worktree spawn dialog scoped to this folder's cwd. */
  onOpenWorktreeDialog?: () => void;
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
  spawningDisabled,
  isGitRepo,
  gitWorktreeEnabled,
  brokenSessionCount,
  onCleanUpBroken,
  onSpawnSession,
  onOpenTerminals,
  onOpenEditor,
  onOpenNativeEditor,
  onOpenPiResources,
  onOpenWorktreeDialog,
}: Props) {
  // Filter out vscode/code from native editors (served via EditorView)
  const filteredNativeEditors = nativeEditors.filter((e) => e.id !== "vscode" && e.id !== "code");
  // +Worktree button visibility: shown when the folder is a known git
  // repo AND a handler is wired. NO loopback gate — the worktree-add
  // happens on the server, which is the user's machine regardless of
  // whether the browser came in via localhost or a tunnel. Server-side
  // networkGuard already enforces access for the REST endpoint.
  // See change: add-worktree-spawn-dialog.
  const showWorktreeButton =
    isGitRepo === true && gitWorktreeEnabled && !!onOpenWorktreeDialog;
  const showCleanUp = (brokenSessionCount ?? 0) > 0 && !!onCleanUpBroken;
  const [confirmCleanUpOpen, setConfirmCleanUpOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* +Session */}
      <button
        onClick={(e) => { e.stopPropagation(); onSpawnSession(); }}
        disabled={spawningDisabled}
        data-testid="spawn-session-btn"
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          spawningDisabled
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-50 cursor-not-allowed"
            : "text-green-400 border-green-500/40 bg-green-500/5 hover:text-green-300 hover:border-green-500/70"
        }`}
        title="New pi session"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiPlus} size={0.5} /> Session
        </span>
      </button>

      {/* +Worktree (localhost + git only) */}
      {showWorktreeButton && (
        <button
          onClick={(e) => { e.stopPropagation(); onOpenWorktreeDialog!(); }}
          data-testid="spawn-worktree-btn"
          className="text-[10px] px-1.5 py-0.5 rounded border text-orange-400 border-orange-500/40 bg-orange-500/5 hover:text-orange-300 hover:border-orange-500/70"
          title="New pi session in a git worktree"
        >
          <span className="inline-flex items-center gap-0.5">
            <Icon path={mdiSourceBranchPlus} size={0.5} /> Worktree
          </span>
        </button>
      )}

      {/* Terminals(N) */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenTerminals(); }}
        className="text-[10px] px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70"
        title="Open terminals view"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiConsoleLine} size={0.5} />
          Terminals({terminalCount})
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
          Editor
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
            <Icon path={mdiBroom} size={0.5} /> Clean up broken ({brokenSessionCount})
          </span>
        </button>
      )}
      {confirmCleanUpOpen && (
        <ConfirmDialog
          message={`Hide ${brokenSessionCount} session${brokenSessionCount === 1 ? "" : "s"} whose cwd no longer exists?`}
          confirmLabel="Hide"
          onConfirm={() => { setConfirmCleanUpOpen(false); onCleanUpBroken?.(); }}
          onCancel={() => setConfirmCleanUpOpen(false)}
        />
      )}

      {/* Pi Resources — right-aligned */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenPiResources(); }}
        className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-purple-400 hover:border-purple-500/50"
        title="Pi Resources"
      >
        <Icon path={mdiToyBrickOutline} size={0.5} />
      </button>
    </div>
  );
}
