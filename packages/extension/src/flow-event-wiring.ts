/**
 * Flow event wiring: registers listeners for pi-flows events
 * and forwards them as protocol messages to the dashboard server.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BridgeContext } from "./bridge-context.js";
import { filterHiddenCommands } from "./bridge-context.js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
  // Architect lifecycle events
  "flow:architect-started": "architect_started",
  "flow:architect-tool-call": "architect_tool_call",
  "flow:architect-tool-result": "architect_tool_result",
  "flow:architect-text": "architect_text",
  "flow:architect-preview": "architect_preview",
  "flow:architect-complete": "architect_complete",
  "flow:architect-replan": "architect_replan",
  "flow:architect-cancelled": "architect_cancelled",
  "flow:architect-saved": "architect_saved",
  "flow:architect-error": "architect_error",
  "flow:architect-context-generating": "architect_context_generating",
  "flow:architect-context-ready": "architect_context_ready",
  "flow:architect-run-handoff": "architect_run_handoff",
  // Autonomous mode feedback
  "flow:autonomous-mode-changed": "flow_autonomous_changed",
};

/** Map of pi-subagents event names to dashboard protocol event types */
export const SUBAGENT_EVENT_MAP: Record<string, string> = {
  "subagents:created": "subagent_created",
  "subagents:started": "subagent_started",
  "subagents:completed": "subagent_completed",
  "subagents:failed": "subagent_failed",
};

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
  // the EventBus emit intercept in bridge.ts (catch-all forwarding).

  // Legacy architect prompt forwarding REMOVED.
  // Previously forwarded flow:prompt-request events with architect-* pipelines
  // as architect_prompt_request to the dashboard. Now handled by
  // ArchitectUIAdapter registered with the PromptBus (see architect-ui-adapter.ts).
}
