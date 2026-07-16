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
 * See change: remove-external-editor-integration.
 */

import { useMobile } from "../hooks/useMobile.js";
import { folderPaneId } from "../lib/folder-pane-id.js";
import { EditorPane } from "./editor-pane/EditorPane.js";
import { SplitWorkspaceProvider } from "./SplitWorkspaceContext.js";

interface Props {
  cwd: string;
  onClose?: () => void;
}

export function FolderEditorView({ cwd }: Props) {
  const isMobile = useMobile();
  return (
    <SplitWorkspaceProvider
      sessionId={folderPaneId(cwd)}
      cwd={cwd}
      orientation={isMobile ? "v" : "h"}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%" }}>
        <EditorPane />
      </div>
    </SplitWorkspaceProvider>
  );
}
