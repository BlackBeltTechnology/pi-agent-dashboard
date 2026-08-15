/**
 * subagent-forward-sites — the two subagent forward paths that call
 * `sendEventForward` DIRECTLY, extracted from the bridge closure so the strip
 * placement is testable.
 *
 * Placement is a decision, not a detail (D2). There is no single chokepoint:
 *  - a strip inside `sendEventForward` would strip the RESYNC REPLY, which is
 *    the one frame the whole pull model depends on staying fat;
 *  - a strip on the EventBus path alone would leak every frame drained by the
 *    buffered-frame flush.
 *
 * So the strip is applied here, per call site, and never in the transport.
 *
 * See change: reduce-subagent-details-payload.
 */
import type { SubagentFrameBuffer } from "./subagent-frame-buffer.js";
import { SubagentFrameBuffer as Buffer } from "./subagent-frame-buffer.js";
import { stripForForward } from "./subagent-frame-strip.js";

/** The bridge's `sendEventForward(channel, data)` transport hook. */
export type SendEventForward = (channel: string, data: Record<string, unknown>) => void;

/**
 * Drain frames buffered while the bridge was not ready and forward them, each
 * STRIPPED — they are intermediate frames of a still-running subagent, and the
 * retained snapshot behind them stays fat for resync. Returns how many were
 * drained. A send failure never stops the drain.
 */
export function flushBufferedSubagentFrames(
  buffer: SubagentFrameBuffer,
  send: SendEventForward,
): number {
  const drained = buffer.drain();
  for (const { channel, data } of drained) {
    try {
      send(channel, stripForForward(data));
    } catch {
      /* keep flushing */
    }
  }
  return drained.length;
}

/**
 * Answer a `subagent_resync_request` with the latest retained snapshot, sent
 * UNSTRIPPED as a synthetic `subagents:started` frame. Returns the resolved
 * `agentId`, or undefined when the reply was a no-op — the bridge was not
 * serving (`canServe` false: retryable), or the agent is unknown / finished /
 * evicted from the bounded snapshot map, in which case the client keeps its
 * last rendered state rather than blanking (C3).
 */
export function serveSubagentResync(
  buffer: SubagentFrameBuffer,
  requestedId: string,
  send: SendEventForward,
  canServe: () => boolean,
  requestId?: string,
  reason?: "open" | "cadence",
): string | undefined {
  if (!canServe()) return undefined;
  const snap = buffer.resync(requestedId, reason);
  if (!snap) return undefined;
  // Echo the requester's correlation token so the server can deliver this reply
  // to that one connection instead of every subscriber of the session. Copied,
  // never assigned onto the retained snapshot.
  // See change: reduce-subagent-details-payload (C5).
  send("subagents:started", requestId ? { ...snap.data, __resyncRequestId: requestId } : snap.data);
  return Buffer.agentIdOf(snap.data) ?? requestedId;
}
