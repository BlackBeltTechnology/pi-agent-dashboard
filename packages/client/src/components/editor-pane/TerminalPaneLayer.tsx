/**
 * Keep-alive terminal layer for the editor pane. Mounts one `TerminalView`
 * per open `term:<id>` tab and toggles visibility by the active tab — so
 * switching to a file tab and back does NOT tear down + reconnect the xterm
 * WS (the single-mount-per-id contract that fix-terminal-half-height-dual-mount
 * established). It fills the same body region as the file viewer; when a file
 * tab is active every terminal is `display:none` and the file viewer shows.
 *
 * The `terminal` viewer-registry entry is a no-op placeholder precisely because
 * this layer is the single mount point — rendering `TerminalView` in both would
 * re-introduce the dual-mount bug.
 *
 * See change: terminals-in-tabbed-panes.
 */

import { openTerminalIds, stripTermId } from "../../lib/use-terminal-pane-tabs.js";
import { useSplitWorkspace } from "../SplitWorkspaceContext.js";
import { TerminalView } from "../TerminalView.js";

export function TerminalPaneLayer() {
  const { paneState, terminal } = useSplitWorkspace();
  const openIds = openTerminalIds(paneState.openFiles);
  if (openIds.length === 0) return null;

  const activeTab = paneState.activeIndex >= 0 ? paneState.openFiles[paneState.activeIndex] : null;
  const activeTermId = activeTab ? stripTermId(activeTab.path) : null;
  const nameOf = (id: string) => {
    const t = terminal.terminals.find((s) => s.id === id);
    return t?.title || t?.shell?.split("/").pop() || undefined;
  };

  return (
    <>
      {openIds.map((id) => (
        <TerminalView
          key={id}
          terminalId={id}
          visible={id === activeTermId}
          terminalName={nameOf(id)}
          onTitle={terminal.onTerminalTitle}
          onClose={terminal.closeTerminalTab}
        />
      ))}
    </>
  );
}
