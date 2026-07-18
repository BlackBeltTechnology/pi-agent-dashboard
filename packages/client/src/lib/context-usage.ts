import type { ContextUsageInfo } from "../components/session/SessionList.js";

/** Minimal shape of an event-reduced session state needed for context usage. */
interface StateLike {
  contextUsage?: ContextUsageInfo;
}

/** Minimal shape of a server-persisted session needed for context usage. */
interface SessionLike {
  contextTokens?: number | null;
  contextWindow?: number;
}

/**
 * Build the per-session context-usage map consumed by both the session card
 * and the content header. Two-tier: live event-reducer value wins; otherwise
 * fall back to server-persisted contextTokens + contextWindow so a session
 * shows usage even before a live turn event arrives this connection.
 * See change: align-content-header-context-usage.
 */
export function buildContextUsageMap(
  sessionStates: Map<string, StateLike>,
  sessions: Map<string, SessionLike>,
): Map<string, ContextUsageInfo> {
  const map = new Map<string, ContextUsageInfo>();
  // First: populate from event-reduced state (live sessions).
  for (const [id, state] of sessionStates) {
    if (state.contextUsage) {
      map.set(id, state.contextUsage);
    }
  }
  // Second: fill in from server-persisted session data (covers all sessions).
  for (const [id, session] of sessions) {
    if (!map.has(id) && session.contextWindow && session.contextTokens !== undefined) {
      map.set(id, { tokens: session.contextTokens ?? null, contextWindow: session.contextWindow });
    }
  }
  return map;
}
