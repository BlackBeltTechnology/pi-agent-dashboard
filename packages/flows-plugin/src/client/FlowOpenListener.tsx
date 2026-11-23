/**
 * Always-mounted, zero-UI receiver of the agent `flow_open` pin (D6).
 *
 * Claimed on `shell-headless`, so every connected browser stores the pin even
 * when the session is off screen or on the mobile layout (where the session
 * card action bar is not mounted). On `flows_open` it writes the attachment
 * with the SERVER-stamped baseline (call time, same host clock as event
 * timestamps — a flow started later consumes it), expands the flow panel like
 * Open flow… does, and acknowledges `flows_open_ack {sessionId, requestId}`.
 * A bounded module-level requestId set (128) stops double handling per tab.
 *
 * Manifest claim: `{ "slot": "shell-headless", "component": "FlowOpenListener" }`.
 * See change: add-flow-open-tool.
 */
import { usePluginMessage, usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import { newAttachmentId, setAttachment } from "./flow-attach-store.js";
import { setFlowCollapsed } from "./flow-collapse-storage.js";

export const FLOWS_OPEN_FRAME = "flows_open";
export const FLOWS_OPEN_ACK = "flows_open_ack";
export const MAX_SEEN_REQUESTS = 128;

interface FlowsOpenFrame {
  sessionId?: unknown;
  requestId?: unknown;
  attachment?: { name?: unknown; source?: unknown; viewOnly?: unknown; baselineStartedAt?: unknown };
}

const seen = new Set<string>();

/** Record a requestId; false when already handled. Oldest evicted past the bound. */
function markSeen(requestId: string): boolean {
  if (seen.has(requestId)) return false;
  seen.add(requestId);
  while (seen.size > MAX_SEEN_REQUESTS) {
    const oldest = seen.values().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
  return true;
}

/** Store one pin; returns the ack to send, or null for a malformed / duplicate frame. */
export function applyFlowsOpen(msg: FlowsOpenFrame): { type: string; sessionId: string; requestId: string } | null {
  const { sessionId, requestId, attachment: a } = msg ?? {};
  if (typeof sessionId !== "string" || !sessionId || typeof requestId !== "string" || !requestId) return null;
  if (!a || typeof a.name !== "string" || !a.name) return null;
  if (!markSeen(requestId)) return null;
  setAttachment(sessionId, {
    id: newAttachmentId(),
    name: a.name,
    source: typeof a.source === "string" ? a.source : undefined,
    baselineStartedAt: typeof a.baselineStartedAt === "number" && Number.isFinite(a.baselineStartedAt) ? a.baselineStartedAt : null,
    ...(a.viewOnly === true ? { viewOnly: true as const } : {}),
  });
  setFlowCollapsed(sessionId, ["dashboard"], false);
  return { type: FLOWS_OPEN_ACK, sessionId, requestId };
}

export function FlowOpenListener(): null {
  const send = usePluginSend();
  usePluginMessage<FlowsOpenFrame>(FLOWS_OPEN_FRAME, (msg) => {
    const ack = applyFlowsOpen(msg);
    if (!ack) return;
    try {
      void send(ack);
    } catch {
      /* no socket: the server counts no ack */
    }
  });
  return null;
}

/** Test-only: forget handled requestIds. */
export function __resetFlowOpenSeenForTests(): void {
  seen.clear();
}

/** Test-only: number of remembered requestIds. */
export function __flowOpenSeenSizeForTests(): number {
  return seen.size;
}
