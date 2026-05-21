/**
 * SubagentPopoutClaim — slot-claim wrapper for the `shell-overlay-route`
 * registration `/session/:sessionId/subagent/:agentId`.
 *
 * Self-derived from the slot props:
 *   - Reads `params.sessionId` / `params.agentId` from the URL.
 *   - Receives `session: DashboardSession | undefined` (resolved by the slot
 *     consumer via `useShellSession(params.sessionId)`).
 *   - Cold-open subscribes to the parent session via `usePluginSend`.
 *   - Reads subagent state via the transitional `useSessionSubagents` primitive.
 *   - Renders the existing `SubagentPopoutPage` body.
 *
 * Replaces the shell-side direct import + `useRoute` dispatch that
 * previously lived in `packages/client/src/App.tsx`.
 *
 * See change: add-flow-agent-popout.
 */
import React, { useEffect, useRef } from "react";
import {
  usePluginSend,
  useSessionSubagents,
  useShellConnectionStatus,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SubagentPopoutPage } from "./SubagentPopoutPage.js";
import type { SessionStateLike } from "./SubagentDetailView.js";
import type { SubagentState } from "./types.js";

export interface SubagentPopoutClaimProps {
  params: Record<string, string>;
  session?: DashboardSession;
  onBack: () => void;
}

export function SubagentPopoutClaim({ params, session, onBack }: SubagentPopoutClaimProps) {
  const sessionId = params.sessionId ?? "";
  const agentId = params.agentId ?? "";
  const send = usePluginSend();
  const subagents = useSessionSubagents(sessionId) as ReadonlyMap<string, SubagentState>;
  const connectionStatus = useShellConnectionStatus();

  // Cold-open subscribe exactly once for this claim instance, AFTER the
  // WebSocket is open. Sending before `connected` is silently dropped by
  // the shell's send primitive (only fires when readyState === OPEN).
  // See change: fix-flows-plugin-polish (popout cold-open subscribe).
  const subscribedRef = useRef(false);
  useEffect(() => {
    if (!sessionId || subscribedRef.current) return;
    if (connectionStatus !== "connected") return;
    subscribedRef.current = true;
    send({ type: "subscribe", sessionId, lastSeq: 0 });
  }, [sessionId, send, connectionStatus]);

  // `subscriptionResolved` is true once we either know the session is unknown
  // or we have at least some subagent data for it. The popout body treats
  // "session metadata known + subagents map populated or empty" as resolved.
  // For a fresh cold-open we initially have neither; show loading until one
  // shows up.
  const subscriptionResolved = !!session || subagents.size > 0;

  const sessionLike: SessionStateLike | undefined = session
    ? { subagents }
    : subagents.size > 0
      ? { subagents }
      : undefined;

  return (
    <SubagentPopoutPage
      sessionId={sessionId}
      agentId={agentId}
      session={sessionLike}
      subscriptionResolved={subscriptionResolved}
      parentLabel={session?.cwd}
      onBack={onBack}
      forwardSessionId={sessionId}
    />
  );
}
