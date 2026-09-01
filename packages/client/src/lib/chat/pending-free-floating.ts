import { isWidgetBarPrompt } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { ChatMessage, InteractiveUiRequest } from "./event-reducer.js";

/**
 * The set of concurrently-pending asks that render inside the grouped
 * MultiAskPanel: pending, free-floating (no `toolCallId`), and not owned by a
 * widget-bar slot. `toolCallId` lives on the pushed `interactiveUi` row, so it
 * is resolved per request off the message stream. Notifies never enter
 * `interactiveRequests`, so they are excluded by construction.
 *
 * See change: surface-concurrent-ask-user-prompts.
 */
export function derivePendingFreeFloating(
  messages: ChatMessage[],
  interactiveRequests: InteractiveUiRequest[],
): InteractiveUiRequest[] {
  const toolCallIdByRequest = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "interactiveUi") continue;
    const rid = (m.args as { requestId?: string } | undefined)?.requestId;
    if (rid && m.toolCallId) toolCallIdByRequest.set(rid, m.toolCallId);
  }
  return interactiveRequests.filter((r) => {
    if (r.status !== "pending") return false;
    if (toolCallIdByRequest.get(r.requestId)) return false;
    const cmp = (r.params as Record<string, unknown> | undefined)?._promptBusComponent as
      | { type?: string }
      | undefined;
    if (cmp?.type && isWidgetBarPrompt(cmp.type)) return false;
    return true;
  });
}
