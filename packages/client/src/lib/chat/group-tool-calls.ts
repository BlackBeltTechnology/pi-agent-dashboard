/**
 * Groups consecutive tool call messages with the same tool name and similar args.
 * Used to collapse repetitive retry loops (e.g. health check polling) in the chat view.
 *
 * Identical tool-only assistant turns are interleaved by `turnSeparator`,
 * `assistant` (empty), `thinking`, `rawEvent`, and `commandFeedback` rows
 * inserted by the reducer. These are *transparent* for grouping purposes:
 * a polling loop that issues the same bash command 40 times still collapses
 * into a single ×N pill as long as no "hard" row (user / different
 * toolResult / interactiveUi / bashOutput) appears between the calls.
 */
import type { ChatMessage } from "./event-reducer.js";

/** Roles that are skipped when looking for the next groupable toolResult. */
const TRANSPARENT_ROLES: ReadonlySet<ChatMessage["role"]> = new Set([
  "assistant",
  "thinking",
  "turnSeparator",
  "rawEvent",
  "commandFeedback",
]);

export interface ToolCallGroup {
  type: "group";
  toolName: string;
  messages: ChatMessage[];
  /**
   * Full walked slice `[start, lastToolEnd)` in original order: the grouped
   * `toolResult` rows PLUS the absorbed transparent rows (thinking, prose,
   * separators) that sat between them. Drives the EXPANDED view so narration
   * renders interleaved with its tool calls. `messages` (toolResult-only) still
   * drives the ×N count and summary. See change: collapse-tool-calls-across-narration.
   */
  rendered: ChatMessage[];
  /** Summary from the first message's args */
  summary: string;
}

export type ChatItem = ChatMessage | ToolCallGroup;

/**
 * Check if two sets of tool args are similar enough to group.
 * Compares JSON-stringified args for exact match.
 */
function argsSimilar(a?: Record<string, unknown>, b?: Record<string, unknown>): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Group consecutive toolResult messages with the same toolName and similar args.
 * Returns a mixed array of ChatMessage and ToolCallGroup items.
 * Single items are never grouped. Running (last) items are never grouped.
 *
 * Transparent rows (see TRANSPARENT_ROLES) between two matching toolResults
 * are absorbed into the group: they are rendered only inside the expanded
 * view (alongside their owning toolResult), never as standalone rows in the
 * collapsed timeline. If no group forms, every consumed row — toolResults
 * and intermediate transparents — is emitted verbatim.
 */
export function groupConsecutiveToolCalls(messages: ChatMessage[]): ChatItem[] {
  const result: ChatItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // Only group toolResult messages
    if (msg.role !== "toolResult") {
      result.push(msg);
      i++;
      continue;
    }
    // A live (running) toolResult is never absorbed into a collapsed group —
    // it is always rendered as a live card. Guard the RUN-STARTING row too
    // (the inner loop only guards subsequent rows). See change:
    // collapse-tool-calls-across-narration.
    if (msg.toolStatus === "running") {
      result.push(msg);
      i++;
      continue;
    }

    // Collect consecutive toolResults with same name and similar args.
    // Transparent intermediate rows (separator/thinking/empty assistant
    // prose) don't break the run; everything else does.
    const group: ChatMessage[] = [msg];
    let j = i + 1;
    let lastToolEnd = j; // exclusive index of last consumed toolResult
    while (j < messages.length) {
      const next = messages[j];
      if (TRANSPARENT_ROLES.has(next.role)) {
        j++;
        continue;
      }
      if (next.role !== "toolResult") break;
      if (next.toolName !== msg.toolName) break;
      if (!argsSimilar(next.args, msg.args)) break;
      // Don't include a currently-running tool in a collapsed group
      if (next.toolStatus === "running") break;
      group.push(next);
      j++;
      lastToolEnd = j;
    }

    if (group.length >= 3) {
      result.push({
        type: "group",
        toolName: msg.toolName ?? "unknown",
        messages: group,
        rendered: messages.slice(i, lastToolEnd),
        summary: msg.toolName ?? "unknown",
      });
      // Skip past the last grouped toolResult only — trailing transparent
      // rows that followed the final toolResult belong to the next iteration.
      i = lastToolEnd;
    } else {
      // Not enough to group — emit every row we walked verbatim, including
      // intermediate transparents, so the chat looks identical to before.
      for (let k = i; k < lastToolEnd; k++) result.push(messages[k]);
      i = lastToolEnd;
    }
  }

  return result;
}
