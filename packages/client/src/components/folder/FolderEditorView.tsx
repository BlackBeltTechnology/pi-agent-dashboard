/**
 * Folder-scoped internal Monaco editor pane.
 *
 * Replaces the removed external `EditorView` (code-server iframe). Mounts the
 * in-browser `EditorPane` rooted at a folder `cwd` instead of a session, by
 * wrapping it in a `SplitWorkspaceProvider` keyed by `folderPaneId(cwd)`.
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
import { useMobile } from "../../hooks/useMobile.js";
import { folderPaneId } from "../../lib/layout/folder-pane-id.js";
import { EditorPane } from "../editor-pane/EditorPane.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

interface Props {
  cwd: string;
  onClose?: () => void;
  /** cwd-scoped terminals (ephemeral filtered in the pane). */
  terminals?: TerminalSession[];
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
}

export function FolderEditorView({
  cwd,
  terminals,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
}: Props) {
  const isMobile = useMobile();
  return (
    <SplitWorkspaceProvider
      sessionId={folderPaneId(cwd)}
      cwd={cwd}
      orientation={isMobile ? "v" : "h"}
      terminals={terminals}
      autoSurfaceTerminals
      onCreateTerminal={onCreateTerminal}
      onKillTerminal={onKillTerminal}
      onRenameTerminal={onRenameTerminal}
      onTerminalTitle={onTerminalTitle}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
        <EditorPane />
      </div>
    </SplitWorkspaceProvider>
  );
}
