/**
 * The bridge-owned follow-up drain, as a pure gate sequence.
 *
 * `bridge.ts` keeps the `isDraining` re-entrancy lock and the wiring; this
 * module owns the DECISION so tests drive the real thing instead of a mirror.
 * Like `followup-buffer.ts`, every collaborator is a parameter: the buffer, a
 * `ctx`-like probe, `emitQueueUpdate` and `sendUserMessage`.
 *
 * Held steers (bridge-owned steer buffer) drain FIRST: a steer not handed to
 * pi at a completed `turn_end` (sent after the last turn, aborted/errored run,
 * skipped handler) ships here as a fresh prompt ahead of follow-ups, one entry
 * per settle, with its `promptId` acked after the send.
 * See change: bridge-owned-cancellable-steer (D5).
 *
 * Gate order (each is a no-op return, nothing is popped before the last):
 *   1. both buffers empty
 *   2. `ctx.hasPendingMessages()` true — pi owns queued items (TUI alt+enter,
 *      or a busy single-bang `!cmd` sent with `deliverAs: "followUp"`); pi
 *      drains those first.
 *   3. `ctx.isIdle()` not true — another run already started between the
 *      settle and the timer. NO retry: the next `agent_settled` drains.
 *
 * Then pop-before-send, emit-before-send, a fresh-turn send with NO options
 * (`{deliverAs:"followUp"}` here would never drain: the run is over), and
 * catch-and-drop (double-shipping is worse than dropping).
 *
 * The trigger is `agent_settled`, which pi emits after it has cleared
 * `_isAgentRunActive`, so a drain scheduled from it observes an idle session.
 * See change: update-pi-core-1-3-adopt-apis (design D4).
 */

import { buildUserMessageContent } from "./command-handler.js";
import type { FollowupBuffer } from "./followup-buffer.js";
import type { SteerBuffer } from "./steer-buffer.js";

/** The slice of pi's `ExtensionContext` the drain reads. */
export interface DrainContext {
  hasPendingMessages?: () => boolean;
  isIdle?: () => boolean;
}

export interface DrainDeps {
  buffer: Pick<FollowupBuffer, "length" | "shift">;
  /** Held steers; drained ahead of `buffer`. Optional for follow-up-only callers. */
  steerBuffer?: Pick<SteerBuffer, "length" | "shift">;
  ctx: DrainContext | undefined;
  emitQueueUpdate: () => void;
  sendUserMessage: (content: ReturnType<typeof buildUserMessageContent>) => void;
  /** Ack a shipped steer's `promptId` (bridge → server `prompt_received`). */
  ackSteer?: (promptId: string | undefined) => void;
}

/** Why a drain call did, or did not, ship an entry. */
export type DrainOutcome = "empty" | "pending" | "busy" | "sent" | "lost";

/** Pop at most one held steer (else one buffered follow-up) and hand it to pi as a fresh turn. */
export function drainOneFollowup(deps: DrainDeps): DrainOutcome {
  const { buffer, steerBuffer, ctx, emitQueueUpdate, sendUserMessage, ackSteer } = deps;
  const steerHeld = (steerBuffer?.length ?? 0) > 0;
  if (!steerHeld && buffer.length === 0) return "empty";

  // TUI-coexistence gate. The probe method lives on `ctx`.
  if (typeof ctx?.hasPendingMessages === "function") {
    try {
      if (ctx.hasPendingMessages()) return "pending";
    } catch { /* probe failure non-fatal */ }
  }

  const idle = (() => {
    try { return ctx?.isIdle?.() === true; } catch { return false; }
  })();
  if (!idle) return "busy";

  // POP FIRST. Once shifted, the entry exists only on this stack frame.
  const steer = steerHeld ? steerBuffer?.shift() : undefined;
  const entry = steer ?? buffer.shift();
  if (!entry) return "empty";
  // Emit immediately so wire-state matches buffer-state BEFORE the pi call.
  emitQueueUpdate();

  try {
    sendUserMessage(buildUserMessageContent(entry.text, entry.images));
    if (steer) ackSteer?.(steer.promptId);
    return "sent";
  } catch (err) {
    console.warn(
      "[dashboard] drainFollowupQueue: pi.sendUserMessage threw — entry lost:",
      err,
    );
    // INTENTIONAL: no re-push. Double-shipping is worse than dropping.
    return "lost";
  }
}
