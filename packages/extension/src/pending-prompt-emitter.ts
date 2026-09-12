/**
 * pending-prompt-emitter — the ONE emitter for re-sending every prompt the
 * bridge's PromptBus is still awaiting an answer for.
 *
 * Two entry points share it so their frames cannot drift (D7):
 *  - the bridge's `onReconnect` replay (no token — every subscriber rebuilds),
 *  - the `prompt_resync_request` handler (echoes the requester token so the
 *    server unicasts each frame to the browser that asked).
 *
 * Frame shape is byte-identical to the bus's own `onDashboardRequest` emit:
 * the original prompt id, resolved component and placement ride along, so a
 * re-emitted prompt dedups against an already-rendered dialog on the client.
 *
 * An empty pending set emits nothing and raises no error (E10); entries whose
 * component never resolved are skipped by `getPendingRequests()` itself —
 * those were never routed to a dashboard, so excluding them is correct, not a
 * gap (D6).
 *
 * See change: fix-pending-prompt-lost-on-replay (design D6/D7).
 */
import type { PromptBus } from "./prompt-bus.js";

/** The bridge's outbound frame sink (`connection.send` in practice). */
export type SendPromptFrame = (msg: Record<string, unknown>) => void;

/**
 * Emit one `prompt_request` per pending prompt. When `resyncRequestId` is
 * given it is echoed as `__resyncRequestId` on EVERY frame — the server's
 * non-consuming requester lookup (peek) routes each of them to the requester.
 * Returns how many frames were emitted.
 */
export function emitPendingPrompts(
  promptBus: PromptBus,
  send: SendPromptFrame,
  sessionId: string,
  resyncRequestId?: string,
): number {
  let emitted = 0;
  for (const { request, component, placement } of promptBus.getPendingRequests()) {
    send({
      type: "prompt_request",
      sessionId,
      promptId: request.id,
      prompt: {
        type: request.type,
        question: request.question,
        options: request.options,
        defaultValue: request.defaultValue,
        pipeline: request.pipeline,
        metadata: request.metadata,
      },
      component,
      placement,
      ...(resyncRequestId ? { __resyncRequestId: resyncRequestId } : {}),
    });
    emitted++;
  }
  return emitted;
}
