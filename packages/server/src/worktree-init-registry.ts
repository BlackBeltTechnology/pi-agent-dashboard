/**
 * In-memory `requestId -> WebSocket` registry for worktree-init
 * progress events. Browser subscribes via `worktree_init_subscribe`
 * BEFORE issuing `POST /api/git/worktree` (or the existing-row
 * install-then-spawn flow). The HTTP handler looks up the WebSocket and
 * streams `worktree_init_*` events ONLY to that connection.
 *
 * Subscriptions auto-expire after `ttlMs` and drop on WebSocket close.
 *
 * See change: generalize-worktree-init-hook.
 */
import type { WebSocket } from "ws";
import type {
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // long enough for slow installs

interface Entry {
  ws: WebSocket;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorktreeInitRegistry {
  subscribe(requestId: string, ws: WebSocket): void;
  unsubscribe(requestId: string): void;
  /** Send a message to the subscribed ws, returns true if delivered. */
  send(requestId: string, msg: ServerToBrowserMessage): boolean;
  size(): number;
  dispose(): void;
}

export function createWorktreeInitRegistry(options?: {
  ttlMs?: number;
  sendTo?: (ws: WebSocket, msg: ServerToBrowserMessage) => void;
}): WorktreeInitRegistry {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const sendTo = options?.sendTo ?? defaultSendTo;
  const map = new Map<string, Entry>();

  // Track which ws holds which requestIds so we can drop on disconnect.
  const wsToRequestIds = new WeakMap<WebSocket, Set<string>>();

  function dropEntry(requestId: string) {
    const entry = map.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    map.delete(requestId);
    const set = wsToRequestIds.get(entry.ws);
    if (set) { set.delete(requestId); }
  }

  return {
    subscribe(requestId, ws) {
      // Replace any prior subscription for the same requestId.
      if (map.has(requestId)) dropEntry(requestId);
      const timer = setTimeout(() => dropEntry(requestId), ttlMs);
      // Allow process to exit naturally even if a subscription is active.
      if (typeof timer.unref === "function") timer.unref();
      map.set(requestId, { ws, timer });
      let set = wsToRequestIds.get(ws);
      if (!set) {
        set = new Set();
        wsToRequestIds.set(ws, set);
        // Drop every subscription this ws owns on close.
        ws.once("close", () => {
          const ids = wsToRequestIds.get(ws);
          if (!ids) return;
          for (const id of ids) dropEntry(id);
        });
      }
      set.add(requestId);
    },

    unsubscribe(requestId) {
      dropEntry(requestId);
    },

    send(requestId, msg) {
      const entry = map.get(requestId);
      if (!entry) return false;
      try { sendTo(entry.ws, msg); return true; }
      catch { return false; }
    },

    size() { return map.size; },

    dispose() {
      for (const requestId of [...map.keys()]) dropEntry(requestId);
    },
  };
}

function defaultSendTo(ws: WebSocket, msg: ServerToBrowserMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}
