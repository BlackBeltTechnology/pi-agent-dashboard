/**
 * ComposerDockHost — the one component App mounts for the composer dock.
 *
 * `App` builds the session chat inside a plain render function (no hooks), but
 * the dock's lanes come from hooks (`useComposerDockLanes`, `useInflightBashTools`).
 * This host is the hook boundary: App passes the bound session's data and the
 * same callbacks the retired strip / `QueuePanel` / `StatusBar` area used, and
 * the host feeds `ComposerDock`. The accordion (`openLane`) stays controlled by
 * App (`useDockAccordion(selectedId)`).
 *
 * Must render under the plugin context and OpenSpec map providers (the lanes
 * resolve the attachment and read slot claims).
 *
 * The host is also the live/targets boundary: Open / Diff on Changes rows and the collapse
 * controls exist only for a dock that is live for the session the editor pane serves
 * (`live` from App ∧ the split workspace is bound to this session).
 *
 * See change: add-composer-dock (tasks 8.1, 8.2).
 * See change: composer-dock-collapse-and-file-open (D3, D6).
 */

import { useInflightBashTools } from "../../hooks/useInflightBashTools.js";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { ComposerDock, type ComposerDockProps } from "./ComposerDock.js";
import { type ComposerDockLanesInput, useComposerDockLanes } from "./useComposerDockLanes.js";

export interface ComposerDockHostProps extends ComposerDockLanesInput {
  /** The bound session's reducer state (unresolved bash tool calls → Commands group). */
  state: SessionState;
  cwd: string | undefined;
  openLane: ComposerDockProps["openLane"];
  onOpenLaneChange: ComposerDockProps["onOpenLaneChange"];
  /** The composer column element measured for compact mode. */
  columnEl?: HTMLElement | null;
  /** `kill_process { pgid }` for the bound session. */
  onKillProcess: (pgid: number) => void;
  /** Scroll the transcript to a command's tool call. */
  onShowTool?: (toolCallId: string) => void;
  /** Open a session (sub-session process rows). */
  onNavigateToSession?: (sessionId: string) => void;
  /** False for a frozen transition underlay: no collapse controls, peek or row targets. Default `true`. */
  live?: boolean;
}

export function ComposerDockHost({
  state,
  cwd,
  openLane,
  onOpenLaneChange,
  columnEl,
  onKillProcess,
  onShowTool,
  onNavigateToSession,
  live = true,
  ...laneInput
}: ComposerDockHostProps) {
  // Open / Diff land in the bound session's editor pane: only when the split workspace serves THIS session.
  const split = useOptionalSplitWorkspace();
  const sessionLive = live && !!laneInput.session && split?.sessionId === laneInput.session.id;
  const lanes = useComposerDockLanes({
    ...laneInput,
    onOpenFile: sessionLive ? split?.openInSplit : undefined,
    onOpenDiff: sessionLive ? split?.openDiffTab : undefined,
  });
  const commands = useInflightBashTools(state);
  return (
    <ComposerDock
      session={laneInput.session}
      cwd={cwd}
      openLane={openLane}
      onOpenLaneChange={onOpenLaneChange}
      columnEl={columnEl}
      live={sessionLive}
      lanes={lanes}
      processes={{ commands, onKill: onKillProcess, onShowTool, onNavigateToSession }}
    />
  );
}
