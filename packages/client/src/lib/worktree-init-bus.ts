/**
 * Process-singleton event bus for worktree-init progress events.
 *
 * App.tsx wires the ws message handler to forward `worktree_init_*`
 * messages into the bus. Consumers subscribe by the run's stable `cwd`
 * (survives refresh, reaches every tab) — the legacy `requestId` channel
 * stays for back-compat. The bus lives outside React state so the
 * consumer's `useEffect` can attach a listener once and not rerender on
 * every progress tick.
 *
 * Also exposes a small `send` injection so consumers can fire the required
 * `worktree_init_subscribe` / `worktree_init_unsubscribe` messages without a
 * direct WebSocket reference. App.tsx calls `setInitSender(send)` once at boot.
 *
 * See change: generalize-worktree-init-hook, friendlier-worktree-init.
 */
import type {
  BrowserToServerMessage,
  WorktreeInitDoneMessage,
  WorktreeInitFailedMessage,
  WorktreeInitProgressMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

export type WorktreeInitEvent =
  | WorktreeInitProgressMessage
  | WorktreeInitDoneMessage
  | WorktreeInitFailedMessage;

type Listener = (ev: WorktreeInitEvent) => void;

const byRequestId = new Map<string, Set<Listener>>();
const byCwd = new Map<string, Set<Listener>>();
let injectedSender: ((msg: BrowserToServerMessage) => void) | null = null;

/** Called from App.tsx after `useWebSocket` returns. */
export function setInitSender(send: ((msg: BrowserToServerMessage) => void) | null): void {
  injectedSender = send;
}

/** App.tsx forwards every matching ws message into the bus. */
export function dispatchInitEvent(ev: WorktreeInitEvent): void {
  const fan = (set: Set<Listener> | undefined) => {
    if (!set) return;
    for (const l of set) { try { l(ev); } catch { /* swallow */ } }
  };
  if (ev.requestId) fan(byRequestId.get(ev.requestId));
  if (ev.cwd) fan(byCwd.get(ev.cwd));
}

/**
 * Listen for events with this `requestId`. Returns an `unsubscribe` cleanup.
 * Sends `worktree_init_subscribe` to the server on first subscribe
 * and `worktree_init_unsubscribe` on last unsubscribe.
 */
export function subscribeInit(requestId: string, listener: Listener): () => void {
  let set = byRequestId.get(requestId);
  if (!set) {
    set = new Set();
    byRequestId.set(requestId, set);
    // First listener for this requestId — tell the server we want events.
    injectedSender?.({ type: "worktree_init_subscribe", requestId });
  }
  set.add(listener);
  return () => {
    const s = byRequestId.get(requestId);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) {
      byRequestId.delete(requestId);
      injectedSender?.({ type: "worktree_init_unsubscribe", requestId });
    }
  };
}

/**
 * Listen for events addressed by the run's stable `cwd`. Sends
 * `worktree_init_subscribe { cwd }` on first subscribe (so the server delivers
 * this run's events to this ws even after a refresh) and
 * `worktree_init_unsubscribe { cwd }` on last unsubscribe.
 */
export function subscribeInitByCwd(cwd: string, listener: Listener): () => void {
  let set = byCwd.get(cwd);
  if (!set) {
    set = new Set();
    byCwd.set(cwd, set);
    injectedSender?.({ type: "worktree_init_subscribe", cwd });
  }
  set.add(listener);
  return () => {
    const s = byCwd.get(cwd);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) {
      byCwd.delete(cwd);
      injectedSender?.({ type: "worktree_init_unsubscribe", cwd });
    }
  };
}

/**
 * Re-send `worktree_init_subscribe { cwd }` for every active cwd listener.
 * Call after a ws reconnect: the server dropped the old socket's subscriptions
 * on close, so a still-running run would otherwise stream into the void.
 * See change: friendlier-worktree-init.
 */
export function resendActiveCwdSubscriptions(): void {
  for (const cwd of byCwd.keys()) injectedSender?.({ type: "worktree_init_subscribe", cwd });
}

/** Test-only: wipe the bus between cases. */
export function __resetInitBusForTests(): void {
  byRequestId.clear();
  byCwd.clear();
  injectedSender = null;
}
