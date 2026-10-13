/**
 * Folder-scoped split-workspace provider: `SplitWorkspaceProvider` keyed by
 * `folderPaneId(cwd)` with the terminal wiring the folder pane needs. Shared by
 * `FolderEditorView` (editor-only surface) and the directory home page
 * (pre-session pane + editor pane), so both read ONE layout/pane state.
 *
 * `defaultMode="split"`: a folder with no stored layout opens with both panes.
 *
 * See changes: remove-external-editor-integration, redesign-directory-home-split.
 */
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type React from "react";
import { useMobile } from "../../hooks/useMobile.js";
import { folderPaneId } from "../../lib/layout/folder-pane-id.js";
import { SplitWorkspaceProvider } from "../split/SplitWorkspaceContext.js";

export interface FolderSplitProviderProps {
  cwd: string;
  /** cwd-scoped terminals (ephemeral filtered in the pane). */
  terminals?: TerminalSession[];
  onCreateTerminal?: (cwd: string) => void;
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
  /** One-shot terminal-focused entry from `?focus=terminal`. */
  focusTerminal?: boolean;
  /** Terminal snapshot applied (`snapshotGeneration > 0`) — the readiness gate. */
  terminalsReady?: boolean;
  /** Fired once the one-shot is honoured (URL param consumption). */
  onFocusConsumed?: () => void;
  children: React.ReactNode;
}

export function FolderSplitProvider({
  cwd,
  terminals,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
  focusTerminal,
  terminalsReady,
  onFocusConsumed,
  children,
}: FolderSplitProviderProps) {
  const isMobile = useMobile();
  return (
    <SplitWorkspaceProvider
      sessionId={folderPaneId(cwd)}
      cwd={cwd}
      orientation={isMobile ? "v" : "h"}
      terminals={terminals}
      autoSurfaceTerminals
      defaultMode="split"
      onCreateTerminal={onCreateTerminal}
      onKillTerminal={onKillTerminal}
      onRenameTerminal={onRenameTerminal}
      onTerminalTitle={onTerminalTitle}
      focusOnMount={focusTerminal}
      terminalsReady={terminalsReady}
      onFocusConsumed={onFocusConsumed}
    >
      {children}
    </SplitWorkspaceProvider>
  );
}
