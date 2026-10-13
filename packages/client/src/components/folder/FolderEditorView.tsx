/**
 * Folder-scoped internal Monaco editor pane.
 *
 * Replaces the removed external `EditorView` (code-server iframe). Mounts the
 * in-browser `EditorPane` rooted at a folder `cwd` instead of a session, by
 * wrapping it in a `FolderSplitProvider` (`SplitWorkspaceProvider` keyed by `folderPaneId(cwd)`).
 *
 * It deliberately omits the session-bound wiring: no `onWatchFiles`
 * (changed-on-disk banner), no `fileResults`, no `changedFiles`. There is no
 * session WS to attach a server file-watch to in folder scope, so the banner
 * simply never appears; a manual Refresh reloads a tab's content (Non-Goal v1).
 *
 * It IS the folder-level terminal surface (replacing the removed `TerminalsView`):
 * `autoSurfaceTerminals` opens a `term:<id>` tab for every non-ephemeral terminal
 * at the folder cwd. See change: terminals-in-tabbed-panes.
 *
 * See change: remove-external-editor-integration.
 */

import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { EditorPane } from "../editor-pane/EditorPane.js";
import { FolderSplitProvider } from "./FolderSplitProvider.js";

interface Props {
  cwd: string;
  onClose?: () => void;
  /** cwd-scoped terminals (ephemeral filtered in the pane). */
  terminals?: TerminalSession[];
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
  /** One-shot terminal-focused entry from `?focus=terminal`. See change:
   *  fix-terminals-action-opens-terminal. */
  focusTerminal?: boolean;
  /** Terminal snapshot applied (`snapshotGeneration > 0`) — the readiness gate. */
  terminalsReady?: boolean;
  /** Fired once the one-shot is honoured (URL param consumption). */
  onFocusConsumed?: () => void;
}

export function FolderEditorView({
  cwd,
  terminals,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
  focusTerminal,
  terminalsReady,
  onFocusConsumed,
}: Props) {
  return (
    <FolderSplitProvider
      cwd={cwd}
      terminals={terminals}
      onCreateTerminal={onCreateTerminal}
      onKillTerminal={onKillTerminal}
      onRenameTerminal={onRenameTerminal}
      onTerminalTitle={onTerminalTitle}
      focusTerminal={focusTerminal}
      terminalsReady={terminalsReady}
      onFocusConsumed={onFocusConsumed}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
        <EditorPane />
      </div>
    </FolderSplitProvider>
  );
}
