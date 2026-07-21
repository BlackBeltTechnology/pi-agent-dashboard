/**
 * Diff-refresh mutation signal.
 *
 * Counts completed mutation tool results (including failed ones) so the shared
 * session-diff refetches after any file-affecting tool. Uses the shared
 * mutation classifier so a new alias needs one classifier entry, not a client
 * edit. Read/search results are excluded because `buildSessionDiff` performs
 * synchronous git work. See change: retain-failed-tool-file-changes.
 */
import { isMutationTool } from "@blackbelt-technology/pi-dashboard-shared/tool-mutation.js";
import type { ChatMessage } from "./event-reducer.js";

/** Monotonic count of classified mutation `toolResult` rows in `messages`. */
export function countMutationResults(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === "toolResult" && isMutationTool(m.toolName)) n++;
  }
  return n;
}
