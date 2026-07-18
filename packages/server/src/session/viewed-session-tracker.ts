/**
 * Viewed-session tracker.
 *
 * Per-session set of WebSocket connections that are currently displaying
 * the session's chat panel (typically the browser is on `/session/:id`).
 * Used by:
 *   - `event-wiring.ts` to gate `isUnreadTrigger`-driven `unread = true`
 *     stamps so a session being actively watched never becomes unread.
 *   - the `session_view` handler in `browser-gateway.ts` to clear unread
 *     when any browser opens an unread session.
 *
 * Read state is GLOBAL across browsers: a session is "viewed" iff at
 * least one connected client has it open. This mirrors mail/Slack:
 * opening on phone clears unread for the laptop too.
 *
 * In-memory only — view state is intrinsically per-connection and has
 * no value to persist.
 *
 * See change: session-card-unread-stripes.
 */

import type { WebSocket } from "ws";

export interface ViewedSessionTracker {
  /** Mark `ws` as viewing `sessionId`. Idempotent. */
  view(sessionId: string, ws: WebSocket): void;
  /** Mark `ws` as no longer viewing `sessionId`. Idempotent. */
  unview(sessionId: string, ws: WebSocket): void;
  /**
   * Remove `ws` from every viewed session. Called from the WebSocket
   * `close` handler so a disconnected browser cannot hold sessions in
   * the viewed state forever.
   */
  unviewAll(ws: WebSocket): void;
  /** Returns true if at least one connected browser views the session. */
  isViewedByAnyone(sessionId: string): boolean;
  /** Test/diagnostic accessor — number of viewers for a session. */
  viewerCount(sessionId: string): number;
}

export function createViewedSessionTracker(): ViewedSessionTracker {
  const viewers = new Map<string, Set<WebSocket>>();

  return {
    view(sessionId: string, ws: WebSocket): void {
      let set = viewers.get(sessionId);
      if (!set) {
        set = new Set<WebSocket>();
        viewers.set(sessionId, set);
      }
      set.add(ws);
    },

    unview(sessionId: string, ws: WebSocket): void {
      const set = viewers.get(sessionId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) viewers.delete(sessionId);
    },

    unviewAll(ws: WebSocket): void {
      for (const [sessionId, set] of viewers) {
        if (set.delete(ws) && set.size === 0) {
          viewers.delete(sessionId);
        }
      }
    },

    isViewedByAnyone(sessionId: string): boolean {
      const set = viewers.get(sessionId);
      return !!set && set.size > 0;
    },

    viewerCount(sessionId: string): number {
      return viewers.get(sessionId)?.size ?? 0;
    },
  };
}
