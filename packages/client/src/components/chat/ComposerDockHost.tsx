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
 * See change: add-composer-dock (tasks 8.1, 8.2).
 */

import { useInflightBashTools } from "../../hooks/useInflightBashTools.js";
import type { SessionState } from "../../lib/chat/event-reducer.js";
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
  ...laneInput
}: ComposerDockHostProps) {
  const lanes = useComposerDockLanes(laneInput);
  const commands = useInflightBashTools(state);
  return (
    <ComposerDock
      session={laneInput.session}
      cwd={cwd}
      openLane={openLane}
      onOpenLaneChange={onOpenLaneChange}
      columnEl={columnEl}
      lanes={lanes}
      processes={{ commands, onKill: onKillProcess, onShowTool, onNavigateToSession }}
    />
  );
}
