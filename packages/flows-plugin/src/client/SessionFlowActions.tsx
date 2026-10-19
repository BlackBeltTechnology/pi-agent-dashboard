import { usePluginSend } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React from "react";
import { FlowActivityBadge } from "./FlowActivityBadge.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";

/**
 * FLOWS-subcard body: flow STATUS only — `FlowActivityBadge` (with Abort while
 * running) when the session has a flow state, else null. The flow actions
 * (Run / Open / New-Edit / Delete), their dialogs and the edit-mode reconcile
 * live in `SessionFlowMenuClaim`. See change: add-session-actions-flyout (D12).
 */
export function SessionFlowActions({
  flowState,
  onAbortFlow,
}: {
  /** Current flow state for this session. Drives the status pill. */
  flowState?: FlowState | null;
  /** Dispatch flow_control abort. Called by the running-flow pill's Abort button. */
  onAbortFlow?: () => void;
}) {
  // Compute running-flow badge inputs from flowState (when present).
  // See change: fix-flows-plugin-polish (A5 + A6).
  if (!flowState) return null;
  const agents = flowState.agents;
  const done = Array.from(agents.values()).filter(
    (a) => a.status === "complete" || a.status === "error" || a.status === "blocked",
  ).length;
  return (
    <FlowActivityBadge
      flowName={flowState.flowName}
      agentsDone={done}
      agentsTotal={agents.size}
      status={flowState.status}
      onAbort={flowState.status === "running" ? onAbortFlow : undefined}
    />
  );
}

/**
 * Slot-consumer wrapper for the `session-card-flows` claim (FLOWS subcard).
 * Reads the per-session flow state and dispatches abort via pluginContext.send.
 * Visibility is gated by `shouldRenderFlowsSubcard` (any flow event). See change:
 * pluginize-flows-via-registry, add-session-actions-flyout.
 */
export function SessionFlowActionsClaim({ session }: { session: DashboardSession }) {
  const { flowState } = useFlowsSessionState(session.id);
  const send = usePluginSend();
  return (
    <SessionFlowActions
      flowState={flowState}
      onAbortFlow={() => send({ type: "flow_control", sessionId: session.id, action: "abort" })}
    />
  );
}
