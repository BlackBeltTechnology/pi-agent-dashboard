/**
 * Tracks in-flight on-demand session load requests from bridge extensions.
 * Handles deduplication, timeouts, and bridge disconnect cleanup.
 */
import type WebSocket from "ws";

export interface PendingLoad {
  sessionId: string;
  requestedAt: number;
  browsers: Set<WebSocket>;
  bridgeSessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingLoadManager {
  /** Start a pending load. Returns false if already pending (dedup). */
  start(sessionId: string, browser: WebSocket, bridgeSessionId: string): boolean;
  /** Add a browser to an existing pending load. Returns false if no pending load exists. */
  addBrowser(sessionId: string, browser: WebSocket): boolean;
  /** Check if a session has a pending load. */
  isPending(sessionId: string): boolean;
  /** Complete a pending load (success or error). Returns the waiting browsers, or null if not found. */
  complete(sessionId: string): Set<WebSocket> | null;
  /** Cancel all pending loads for a specific bridge. Returns Map of sessionId → browsers. */
  cancelForBridge(bridgeSessionId: string): Map<string, Set<WebSocket>>;
  /** Cancel a specific pending load. Returns the waiting browsers, or null. */
  cancel(sessionId: string): Set<WebSocket> | null;
  /** Clean up all timers. */
  dispose(): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createPendingLoadManager(
  onTimeout: (sessionId: string, browsers: Set<WebSocket>) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): PendingLoadManager {
  const pending = new Map<string, PendingLoad>();

  function createTimer(sessionId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const load = pending.get(sessionId);
      if (load) {
        pending.delete(sessionId);
        onTimeout(sessionId, load.browsers);
      }
    }, timeoutMs);
  }

  return {
    start(sessionId: string, browser: WebSocket, bridgeSessionId: string): boolean {
      if (pending.has(sessionId)) return false;
      const load: PendingLoad = {
        sessionId,
        requestedAt: Date.now(),
        browsers: new Set([browser]),
        bridgeSessionId,
        timer: createTimer(sessionId),
      };
      pending.set(sessionId, load);
      return true;
    },

    addBrowser(sessionId: string, browser: WebSocket): boolean {
      const load = pending.get(sessionId);
      if (!load) return false;
      load.browsers.add(browser);
      return true;
    },

    isPending(sessionId: string): boolean {
      return pending.has(sessionId);
    },

    complete(sessionId: string): Set<WebSocket> | null {
      const load = pending.get(sessionId);
      if (!load) return null;
      clearTimeout(load.timer);
      pending.delete(sessionId);
      return load.browsers;
    },

    cancelForBridge(bridgeSessionId: string): Map<string, Set<WebSocket>> {
      const cancelled = new Map<string, Set<WebSocket>>();
      for (const [sessionId, load] of pending) {
        if (load.bridgeSessionId === bridgeSessionId) {
          clearTimeout(load.timer);
          pending.delete(sessionId);
          cancelled.set(sessionId, load.browsers);
        }
      }
      return cancelled;
    },

    cancel(sessionId: string): Set<WebSocket> | null {
      const load = pending.get(sessionId);
      if (!load) return null;
      clearTimeout(load.timer);
      pending.delete(sessionId);
      return load.browsers;
    },

    dispose(): void {
      for (const load of pending.values()) {
        clearTimeout(load.timer);
      }
      pending.clear();
    },
  };
}
