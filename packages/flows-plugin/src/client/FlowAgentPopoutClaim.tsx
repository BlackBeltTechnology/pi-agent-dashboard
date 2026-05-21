/**
 * FlowAgentPopoutClaim — slot-claim wrapper for the `shell-overlay-route`
 * registration `/session/:sid/flow/:flowId/agent/:agentId`.
 *
 * Self-derived from the slot props:
 *   - Reads `params.sid` / `params.flowId` (URL-decoded) / `params.agentId`.
 *   - Receives `session: DashboardSession | undefined` from the slot consumer.
 *   - Cold-open subscribes to the parent session via `usePluginSend`.
 *   - Reads flow state via `useFlowsSessionState(params.sid)`.
 *   - Renders the existing `FlowAgentPopoutPage` body.
 *
 * See change: add-flow-agent-popout.
 */
import React, { useEffect, useRef } from "react";
import {
  usePluginSend,
  useShellConnectionStatus,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { FlowAgentPopoutPage } from "./FlowAgentPopoutPage.js";

export interface FlowAgentPopoutClaimProps {
  params: Record<string, string>;
  session?: DashboardSession;
  onBack: () => void;
}

export function FlowAgentPopoutClaim({ params, session, onBack }: FlowAgentPopoutClaimProps) {
  const sessionId = params.sid ?? "";
  const flowId = params.flowId ?? "";
  const agentId = params.agentId ?? "";
  const send = usePluginSend();
  const { flowStates } = useFlowsSessionState(sessionId);
  const connectionStatus = useShellConnectionStatus();

  // Cold-open subscribe exactly once, AFTER the WebSocket is open.
  // See change: fix-flows-plugin-polish (popout cold-open subscribe).
  const subscribedRef = useRef(false);
  useEffect(() => {
    if (!sessionId || subscribedRef.current) return;
    if (connectionStatus !== "connected") return;
    subscribedRef.current = true;
    send({ type: "subscribe", sessionId, lastSeq: 0 });
  }, [sessionId, send, connectionStatus]);

  // The popout page's empty-state ladder evaluates loading → no session →
  // no flow → no agent. We forward `flowStates` via the lightweight shape
  // FlowAgentPopoutPage expects.
  const subscriptionResolved = !!session || flowStates.size > 0;
  const sessionLike = session || flowStates.size > 0
    ? { flowStates }
    : undefined;

  return (
    <FlowAgentPopoutPage
      sessionId={sessionId}
      flowId={flowId}
      agentId={agentId}
      session={sessionLike}
      subscriptionResolved={subscriptionResolved}
      parentLabel={session?.cwd}
      onBack={onBack}
    />
  );
}
