import { useEffect, useRef } from "react";
import type { ConnectionStatus } from "./useWebSocket.js";

/**
 * Dispatches `session_view` / `session_unview` messages to the server based
 * on the currently-viewed session id, with re-send semantics on WebSocket
 * (re)connect.
 *
 * Lifecycle rules:
 *   1. When `viewedSessionId` becomes a non-null value, send `session_view`.
 *   2. When `viewedSessionId` changes to a different non-null value, send
 *      `session_unview` for the previous id followed by `session_view` for
 *      the new id.
 *   3. When `viewedSessionId` becomes null (navigated away), send
 *      `session_unview` for the previous id.
 *   4. On every transition of `connectionStatus` INTO "connected" (initial
 *      connect or reconnect), re-send `session_view` for the currently-
 *      viewed id (if any) so server-side state re-syncs.
 *
 * Network-level send-or-not is the caller's concern via the `send` function
 * (it's expected to silently drop sends while the socket is not OPEN — the
 * reconnect re-send rule handles the recovery).
 *
 * See change: session-card-unread-stripes.
 */
export interface UseViewDispatcherDeps {
  viewedSessionId: string | null;
  connectionStatus: ConnectionStatus;
  send: (msg: { type: "session_view" | "session_unview"; sessionId: string }) => void;
}

export function useViewDispatcher(deps: UseViewDispatcherDeps): void {
  const { viewedSessionId, connectionStatus, send } = deps;

  const previousIdRef = useRef<string | null>(null);
  const previousStatusRef = useRef<ConnectionStatus | null>(null);

  // Effect 1: react to viewedSessionId transitions
  useEffect(() => {
    const prev = previousIdRef.current;
    const next = viewedSessionId;

    if (prev !== next) {
      if (prev !== null) {
        send({ type: "session_unview", sessionId: prev });
      }
      if (next !== null) {
        send({ type: "session_view", sessionId: next });
      }
    }

    previousIdRef.current = next;
  }, [viewedSessionId, send]);

  // Effect 2: re-send session_view on every (re)connect
  useEffect(() => {
    const prevStatus = previousStatusRef.current;
    if (connectionStatus === "connected" && prevStatus !== "connected") {
      // Just (re)connected. Re-publish the current view so the server's
      // viewed-session map matches reality.
      const id = previousIdRef.current;
      if (id !== null) {
        send({ type: "session_view", sessionId: id });
      }
    }
    previousStatusRef.current = connectionStatus;
  }, [connectionStatus, send]);
}
