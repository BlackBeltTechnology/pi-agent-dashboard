/**
 * Process-singleton event bus for worktree-bootstrap progress events.
 *
 * App.tsx wires the ws message handler to forward `worktree_bootstrap_*`
 * messages into the bus; `WorktreeSpawnDialog` (or any future consumer)
 * subscribes by `requestId`. The bus lives outside React state so the
 * dialog's `useEffect` can attach a listener once and not rerender on
 * every progress tick.
 *
 * Also exposes a small `send` injection so the dialog can fire the
 * required `worktree_bootstrap_subscribe` / `worktree_bootstrap_unsubscribe`
 * messages without needing a direct reference to the WebSocket. App.tsx
 * calls `setBootstrapSender(send)` once during boot.
 *
 * See change: harden-worktree-spawn.
 */
import type {
  BrowserToServerMessage,
  WorktreeBootstrapDoneMessage,
  WorktreeBootstrapFailedMessage,
  WorktreeBootstrapProgressMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

export type WorktreeBootstrapEvent =
  | WorktreeBootstrapProgressMessage
  | WorktreeBootstrapDoneMessage
  | WorktreeBootstrapFailedMessage;

type Listener = (ev: WorktreeBootstrapEvent) => void;

const byRequestId = new Map<string, Set<Listener>>();
let injectedSender: ((msg: BrowserToServerMessage) => void) | null = null;

/** Called from App.tsx after `useWebSocket` returns. */
export function setBootstrapSender(send: ((msg: BrowserToServerMessage) => void) | null): void {
  injectedSender = send;
}

/** App.tsx forwards every matching ws message into the bus. */
export function dispatchBootstrapEvent(ev: WorktreeBootstrapEvent): void {
  const set = byRequestId.get(ev.requestId);
  if (!set) return;
  for (const l of set) {
    try { l(ev); } catch { /* swallow */ }
  }
}

/**
 * Listen for events with this `requestId`. Returns an `unsubscribe` cleanup.
 * Sends `worktree_bootstrap_subscribe` to the server on first subscribe
 * and `worktree_bootstrap_unsubscribe` on last unsubscribe.
 */
export function subscribeBootstrap(requestId: string, listener: Listener): () => void {
  let set = byRequestId.get(requestId);
  if (!set) {
    set = new Set();
    byRequestId.set(requestId, set);
    // First listener for this requestId — tell the server we want events.
    injectedSender?.({ type: "worktree_bootstrap_subscribe", requestId });
  }
  set.add(listener);
  return () => {
    const s = byRequestId.get(requestId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) {
      byRequestId.delete(requestId);
      injectedSender?.({ type: "worktree_bootstrap_unsubscribe", requestId });
    }
  };
}

/** Test-only: wipe the bus between cases. */
export function __resetBootstrapBusForTests(): void {
  byRequestId.clear();
  injectedSender = null;
}
