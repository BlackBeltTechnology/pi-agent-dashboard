/**
 * Flow event wiring: registers listeners for pi-flows events
 * and forwards them as protocol messages to the dashboard server.
 */

import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BridgeContext } from "./bridge-context.js";
import { filterHiddenCommands } from "./bridge-context.js";

/** Map of pi-flows event names to dashboard protocol event types */
export const FLOW_EVENT_MAP: Record<string, string> = {
  "flow:flow-started": "flow_started",
  "flow:agent-started": "flow_agent_started",
  "flow:agent-complete": "flow_agent_complete",
  "flow:agent-error": "flow_agent_error",
  "flow:subagent-tool-call": "flow_tool_call",
  "flow:subagent-tool-result": "flow_tool_result",
  "flow:assistant-text": "flow_assistant_text",
  "flow:thinking-text": "flow_thinking_text",
  "flow:loop-iteration": "flow_loop_iteration",
  "flow:auto-decision": "flow_auto_decision",
  "flow:complete": "flow_complete",
  "flow:summary-started": "flow_summary_started",
  "flow:summary-ready": "flow_summary_ready",
  "flow:summary-dismissed": "flow_summary_dismissed",
  // Autonomous mode feedback
  "flow:autonomous-mode-changed": "flow_autonomous_changed",
  // NOTE: nodeKind / outcome / typed outputs ride INSIDE the event `data` and are
  // forwarded verbatim by the bridge.ts EventBus catch-all — no per-field map entry.
  // See change: rework-flows-plugin-for-new-pi-flows (consumes pi-flows surface-node-kind).
};

/**
 * Deps the EventBus forwarding wiring needs from the bridge. The bridge owns
 * the transport (`sendEventForward`), the readiness gates, and the subagent
 * frame buffer; this module owns WHICH channels are forwarded and HOW they are
 * observed. See change: fix-automation-run-lifecycle.
 */
export interface EventBusForwardingDeps {
  /** Send one frame as an `event_forward` (applies the channel rename map). */
  sendEventForward: (channel: string, data: Record<string, unknown>) => void;
  /** True once `session_start` established the session id. */
  isSessionReady: () => boolean;
  /** False once a newer bridge instance took over. */
  isActive: () => boolean;
  /** True while the WebSocket transport is actually open. */
  isConnected: () => boolean;
  /** Subagent-channel predicate + latest-wins buffer (reconcilable state). */
  subagent: {
    isSubagentChannel: (channel: string) => boolean;
    markForwarded: (channel: string, data: Record<string, unknown>) => void;
    buffer: (channel: string, data: Record<string, unknown>) => boolean;
    /**
     * Drop the cumulative `details.entries` timeline from a NON-terminal
     * subagent frame before it goes on the wire. MUST clone — the buffer
     * retains frames by reference, so the fat pull source stays fat.
     * See change: reduce-subagent-details-payload (D2).
     */
    stripForForward: (data: Record<string, unknown>, channel?: string) => Record<string, unknown>;
  };
}

/**
 * Forward one EventBus frame, applying the gates the bridge has always applied:
 * subagent frames forward live only when ready AND the transport is open (else
 * they are buffered latest-wins per agent); every other channel forwards when
 * ready. Forwarding failure MUST never propagate to the emitter.
 * See change: fix-automation-run-lifecycle.
 */
export function forwardBusEvent(
  deps: EventBusForwardingDeps,
  channel: string,
  data: unknown,
): void {
  try {
    const eventData = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    if (deps.subagent.isSubagentChannel(channel)) {
      if (deps.isSessionReady() && deps.isActive() && deps.isConnected()) {
        // Buffer the FAT frame, forward the thin one. The strip clones, so the
        // retained snapshot (the resync source) keeps its full timeline.
        deps.sendEventForward(channel, deps.subagent.stripForForward(eventData, channel));
        deps.subagent.markForwarded(channel, eventData);
      } else if (!deps.subagent.buffer(channel, eventData)) {
        console.warn(
          `[dashboard] subagent frame dropped (no agentId) channel=${channel} while not ready`,
        );
      }
    } else if (deps.isSessionReady() && deps.isActive()) {
      deps.sendEventForward(channel, eventData);
    }
  } catch {
    /* forwarding failure must never break event delivery */
  }
}

/** Map of pi-subagents event names to dashboard protocol event types */
export const SUBAGENT_EVENT_MAP: Record<string, string> = {
  "subagents:created": "subagent_created",
  "subagents:started": "subagent_started",
  "subagents:completed": "subagent_completed",
  "subagents:failed": "subagent_failed",
};

/** Minimal shape of the host event surface this module uses. */
interface PiEventsLike {
  emit: (channel: string, data: unknown) => void;
  on: (channel: string, handler: (data: unknown) => void) => (() => void) | void;
}

/**
 * Every EventBus channel the bridge forwards. Derived from the rename maps so a
 * mapped channel can never be silently unforwarded.
 * See change: fix-automation-run-lifecycle.
 */
export const EVENT_BUS_MAP_FOR_TEST: Record<string, string> = {
  ...FLOW_EVENT_MAP,
  ...SUBAGENT_EVENT_MAP,
};

export function forwardedBusChannels(extraMaps: Array<Record<string, string>> = []): string[] {
  const keys = new Set<string>();
  for (const map of [FLOW_EVENT_MAP, SUBAGENT_EVENT_MAP, ...extraMaps]) {
    for (const channel of Object.keys(map)) keys.add(channel);
  }
  return [...keys];
}

/**
 * Wire EventBus forwarding: ONE subscription per declared channel.
 *
 * MUST NOT wrap/replace `events.emit`. pi gives every extension its own
 * `events` facade (`createExtensionAPI` → `events: { emit, on }`) over a shared
 * bus, so mutating OUR `emit` only ever observes OUR OWN emissions — pi-flows'
 * `flow:complete` (and every other foreign emission) bypasses it entirely,
 * which left automation runs unfinalized until the max-age reaper.
 * `on()` observes every emitter. Returns a dispose releasing our subscriptions.
 * See change: fix-automation-run-lifecycle.
 */
export function registerEventBusForwarding(
  events: PiEventsLike | undefined,
  deps: EventBusForwardingDeps,
  extraMaps: Array<Record<string, string>> = [],
): () => void {
  if (!events) return () => {};
  const unsubscribers: Array<() => void> = [];
  for (const channel of forwardedBusChannels(extraMaps)) {
    const off = events.on(channel, (data: unknown) => forwardBusEvent(deps, channel, data));
    if (typeof off === "function") unsubscribers.push(off);
  }
  return () => {
    for (const off of unsubscribers) {
      try {
        off();
      } catch {
        /* keep releasing */
      }
    }
    unsubscribers.length = 0;
  };
}

/**
 * Register flow event listeners on pi.events.
 * Must be called after session_start when pi.events is available.
 *
 * @param bc - Bridge context (mutable state)
 * @param isSessionReady - Function that returns whether session is ready
 * @param getFlowsList - Function to get current flows list
 */
export function registerFlowEventListeners(
  bc: BridgeContext,
  isSessionReady: () => boolean,
  getFlowsList: () => FlowInfo[],
): void {
  const { pi, connection } = bc;
  if (!pi.events) return;

  // Re-send commands and flows list when pi-flows discovers new flows or completes
  const resendCommandsAndFlows = () => {
    if (!isSessionReady()) return;
    const commands = filterHiddenCommands(pi.getCommands());
    connection.send({ type: "commands_list", sessionId: bc.sessionId, commands });
    const flows = getFlowsList();
    connection.send({ type: "flows_list", sessionId: bc.sessionId, flows });
  };
  pi.events.on("flow:rediscover", resendCommandsAndFlows);
  pi.events.on("flow:complete", resendCommandsAndFlows);

  // Note: event_forward sending for flow and subagent events is handled by
  // subscription-based forwarding (`registerEventBusForwarding` above, wired
  // from bridge.ts) — NOT by an emit intercept.

  // Legacy architect prompt forwarding REMOVED.
  // Previously forwarded flow:prompt-request events with architect-* pipelines
  // as architect_prompt_request to the dashboard. Now handled by
  // ArchitectUIAdapter registered with the PromptBus (see architect-ui-adapter.ts).
}
