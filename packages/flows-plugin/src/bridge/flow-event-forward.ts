/**
 * Declares every pi-flows run channel through the generic plugin event-forward
 * seam (`dashboard:register-event-forward`) — core holds no flow map — and
 * asks the core bridge to resend `commands_list` when pi-flows rediscovers or
 * completes (`dashboard:commands-changed`).
 *
 * Keys (design D1): step channels are `stream` keyed `stepId`; run start /
 * complete are `stream` keyed `flowName`; `flow:auto-decision` is `stream`
 * keyed `agentName`; the keyless summary / autonomous channels stay `live`
 * (dropped while not ready, as before). `nodeKind` / `outcome` / `itemIndex`
 * ride inside the payload, forwarded verbatim.
 *
 * Declared on activation and on every `dashboard:bridge-ready` (load-order
 * handshake). Never throws. See change: update-flows-plugin (D1, D3, D4).
 */
import {
  BRIDGE_READY_CHANNEL,
  COMMANDS_CHANGED_CHANNEL,
  type EventForwardChannelSpec,
  type EventForwardDeclaration,
  REGISTER_EVENT_FORWARD_CHANNEL,
} from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";

const step = (as: string): EventForwardChannelSpec => ({ as, delivery: "stream", key: "stepId" });
const run = (as: string): EventForwardChannelSpec => ({ as, delivery: "stream", key: "flowName" });
const live = (as: string): EventForwardChannelSpec => ({ as, delivery: "live" });

/** pi-flows bus channel → forwarded dashboard event type + delivery. */
export const FLOW_RUN_CHANNELS: Readonly<Record<string, EventForwardChannelSpec>> = Object.freeze({
  "flow:agent-started": step("flow_agent_started"),
  "flow:agent-complete": step("flow_agent_complete"),
  "flow:agent-error": step("flow_agent_error"),
  "flow:subagent-tool-call": step("flow_tool_call"),
  "flow:subagent-tool-result": step("flow_tool_result"),
  "flow:assistant-text": step("flow_assistant_text"),
  "flow:thinking-text": step("flow_thinking_text"),
  "flow:loop-iteration": step("flow_loop_iteration"),
  "flow:decision": step("flow_decision"),
  "flow:flow-started": run("flow_started"),
  "flow:complete": run("flow_complete"),
  "flow:auto-decision": { as: "flow_auto_decision", delivery: "stream", key: "agentName" },
  "flow:summary-started": live("flow_summary_started"),
  "flow:summary-ready": live("flow_summary_ready"),
  "flow:summary-dismissed": live("flow_summary_dismissed"),
  "flow:autonomous-mode-changed": live("flow_autonomous_changed"),
});

/** Persisted pi-flows run records (mirrors the manifest `replayEntryTypes`). */
export const FLOW_REPLAY_ENTRY_TYPES: readonly string[] = Object.freeze(["flow-event"]);

export const FLOW_RUN_DECLARATION: EventForwardDeclaration = {
  pluginId: "flows",
  channels: { ...FLOW_RUN_CHANNELS },
  replayEntryTypes: [...FLOW_REPLAY_ENTRY_TYPES],
};

/** pi-flows events after which its registered commands may have changed. */
const COMMANDS_TRIGGERS = ["flow:rediscover", "flow:complete"] as const;

interface PiEvents {
  on(name: string, fn: (data: unknown) => void): unknown;
  emit(name: string, data: unknown): unknown;
}

export function startFlowEventForward(pi: { events?: PiEvents }): void {
  const events = pi.events;
  if (!events || typeof events.emit !== "function" || typeof events.on !== "function") return;
  const declare = () => {
    try {
      events.emit(REGISTER_EVENT_FORWARD_CHANNEL, FLOW_RUN_DECLARATION);
    } catch {
      /* never break activation */
    }
  };
  declare();
  try {
    events.on(BRIDGE_READY_CHANNEL, declare);
  } catch {
    /* noop */
  }
  const commandsChanged = () => {
    try {
      events.emit(COMMANDS_CHANGED_CHANNEL, {});
    } catch {
      /* best-effort */
    }
  };
  for (const name of COMMANDS_TRIGGERS) {
    try {
      events.on(name, commandsChanged);
    } catch {
      /* noop */
    }
  }
}
