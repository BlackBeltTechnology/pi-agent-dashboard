/**
 * Delivers the per-commit arrival decision (which tool rows are entering, whether
 * a completion cue is allowed) from `ChatView` to the rows it renders, without
 * threading props through the virtualizer. The default value is "no motion", so
 * every other consumer of `ToolCallStep` / `ToolBurstGroup` (flow detail views,
 * embeds that mount rows directly) behaves exactly as before.
 *
 * Entering is LATCHED per component instance: `@starting-style` acts only at
 * first style resolution, so the class stays for the instance's life, never
 * re-triggers, and removing it can never cut a transition short.
 *
 * See change: add-fluid-chat-motion (D2, D7).
 */
import { createContext, useContext, useEffect, useState } from "react";

export interface ChatMotionValue {
  enteringToolIds: ReadonlySet<string>;
  cueAllowed: boolean;
}

const EMPTY: ReadonlySet<string> = new Set<string>();
export const NO_CHAT_MOTION: ChatMotionValue = { enteringToolIds: EMPTY, cueAllowed: false };

export const ChatMotionContext = createContext<ChatMotionValue>(NO_CHAT_MOTION);

/** How long a completion cue stays "live" (a later manual expand must never cue). */
export const COMPLETION_CUE_MS = 400;

export const CHAT_ENTER_CLASS = "chat-motion-enter";
export const CHAT_CUE_CLASS = "chat-motion-cue";

/** Latches the entering flag of a keyed tool row at first render of this instance. */
export function useToolEntering(toolCallId: string): boolean {
  const ctx = useContext(ChatMotionContext);
  const [entering] = useState(() => ctx.enteringToolIds.has(toolCallId));
  return entering;
}

/** Latches whether ALL given ids are new at first render (a group is entering only then). */
export function useGroupEntering(ids: readonly string[]): boolean {
  const ctx = useContext(ChatMotionContext);
  const [entering] = useState(() => ids.length > 0 && ids.every((id) => ctx.enteringToolIds.has(id)));
  return entering;
}

/**
 * Completion cue: true for `COMPLETION_CUE_MS` after THIS instance observes a
 * running→(complete|error) flip while the commit allows cues. A mount that is
 * already settled never cues. The flip is detected during render (the supported
 * "adjust state while rendering" pattern) so the cue mounts in the same commit
 * as the new icon — no un-animated frame in between.
 */
export function useCompletionCue(status: string): boolean {
  const { cueAllowed } = useContext(ChatMotionContext);
  const [prevStatus, setPrevStatus] = useState(status);
  const [cue, setCue] = useState(false);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (prevStatus === "running" && (status === "complete" || status === "error") && cueAllowed) setCue(true);
    else if (status === "running") setCue(false);
  }
  useEffect(() => {
    if (!cue) return;
    const timer = setTimeout(() => setCue(false), COMPLETION_CUE_MS);
    return () => clearTimeout(timer);
  }, [cue]);
  return cue;
}
