/**
 * Build a push notification payload from a session and triggering event.
 * Pure helper — no I/O, no side effects.
 * See change: add-server-push-notifications.
 */
import type { DashboardSession, DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PushPayload } from "./push-types.js";

export function buildPushPayload(
  session: DashboardSession,
  event: DashboardEvent,
): PushPayload {
  const sessionId = session.id;

  // Determine title and body from event + session context
  let title: string;
  let body: string;

  if (event.eventType === "agent_end") {
    const error = (event.data as { error?: unknown } | undefined)?.error;
    if (error) {
      const errStr = typeof error === "string" ? error : "An error occurred";
      title = "Session crashed";
      body = truncate(
        `${session.name || sessionId}: ${errStr}`,
        500,
      );
    } else {
      // Successful completion
      title = "Session completed";
      body = truncate(
        `${session.name || sessionId} — finished successfully`,
        500,
      );
    }
  } else {
    // ask_user transition
    const toolName = event.data?.toolName
      ? String(event.data.toolName)
      : session.currentTool || "unknown";
    title = "Agent needs input";
    body = truncate(
      `${session.name || sessionId} — waiting for your response (${toolName})`,
      500,
    );
  }

  return {
    type: "session_attention",
    sessionId,
    title: truncate(title, 200),
    body: truncate(body, 500),
    url: `/session/${sessionId}`,
  };
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
