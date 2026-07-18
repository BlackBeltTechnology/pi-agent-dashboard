/**
 * Selector / hook for the SessionActivityBar.
 *
 * Filters the client-side event reducer's `toolCalls` map down to the
 * unresolved `bash` tool calls, returning a stable, sortable shape:
 * `{ toolCallId, command, startedAt }`. Non-bash tools and resolved
 * (`complete` / `error`) bash tools are excluded.
 *
 * Pure: `selectInflightBashTools` takes a SessionState and returns a new
 * array on each call. The React-flavored `useInflightBashTools` adds
 * memoization for component consumers.
 *
 * See change: redesign-process-list-activity-bar.
 */
import { useMemo } from "react";
import type { SessionState, ToolCallState } from "../lib/chat/event-reducer.js";

export interface InflightBashTool {
  toolCallId: string;
  command: string;
  startedAt: number;
}

function extractCommand(args: ToolCallState["args"]): string {
  if (!args || typeof args !== "object") return "";
  const cmd = (args as Record<string, unknown>).command;
  return typeof cmd === "string" ? cmd : "";
}

/**
 * Pure selector: extracts the unresolved bash tool calls from a session
 * state. Returns an empty array when `state` is undefined.
 *
 * Ordering: newest-first by `startedAt` (descending). The activity bar's
 * visible cap takes the first N entries, so newest activity wins the
 * limited slots.
 */
export function selectInflightBashTools(
  state: SessionState | undefined,
): InflightBashTool[] {
  if (!state) return [];
  const out: InflightBashTool[] = [];
  for (const tc of state.toolCalls.values()) {
    if (tc.status !== "running") continue;
    if (tc.toolName.toLowerCase() !== "bash") continue;
    out.push({
      toolCallId: tc.toolCallId,
      command: extractCommand(tc.args),
      startedAt: tc.startedAt ?? 0,
    });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

/** React-hook wrapper around `selectInflightBashTools` with `useMemo`. */
export function useInflightBashTools(
  state: SessionState | undefined,
): InflightBashTool[] {
  return useMemo(() => selectInflightBashTools(state), [state]);
}
