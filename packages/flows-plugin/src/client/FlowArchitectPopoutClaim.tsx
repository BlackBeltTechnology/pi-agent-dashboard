/**
 * FlowArchitectPopoutClaim — slot-claim wrapper for the
 * `shell-overlay-route` registration `/session/:sid/architect`.
 *
 * Reads architect state via the plugin's `useFlowsSessionState`,
 * cold-open subscribes, renders `FlowArchitectPopoutPage`.
 *
 * See change: fix-flows-plugin-polish (A4).
 */
import React, { useEffect, useRef } from "react";
import {
  usePluginSend,
  useShellConnectionStatus,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { FlowArchitectPopoutPage } from "./FlowArchitectPopoutPage.js";

export interface FlowArchitectPopoutClaimProps {
  params: Record<string, string>;
  session?: DashboardSession;
  onBack: () => void;
}

export function FlowArchitectPopoutClaim({ params, session, onBack }: FlowArchitectPopoutClaimProps) {
  const sessionId = params.sid ?? "";
  const send = usePluginSend();
  const { architectState } = useFlowsSessionState(sessionId);
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

  const subscriptionResolved = !!session || architectState !== null;

  return (
    <FlowArchitectPopoutPage
      sessionId={sessionId}
      architectState={architectState ?? undefined}
      subscriptionResolved={subscriptionResolved}
      parentLabel={session?.cwd}
      onBack={onBack}
    />
  );
}
