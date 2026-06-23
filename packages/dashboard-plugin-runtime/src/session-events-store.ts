/**
 * Module-level per-session event store.
 *
 * Plugins consume the store via `useSessionEvents(sessionId)` (in
 * `plugin-context.tsx`); the dashboard shell publishes via
 * `publishSessionEvent` / `clearSessionEvents` from its message
 * handler. The store is a side-channel from the shell's reducer-based
 * `SessionState` — the events are the same; the store gives plugins
 * read access without coupling them to the shell's reducer shape.
 *
 * Implementation: per-session arrays of events plus per-session
 * subscriber Sets. `useSessionEvents` uses `useSyncExternalStore` for
 * tear-free subscription. Array reference is stable across no-op
 * publishes (returned snapshot is the same reference until a new event
 * is appended).
 *
 * See change: pluginize-flows-via-registry.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const events = new Map<string, readonly DashboardEvent[]>();
const subscribers = new Map<string, Set<() => void>>();

const EMPTY_EVENTS: readonly DashboardEvent[] = Object.freeze([]);

/**
 * Publish a single event for a session. Plugins subscribed to that
 * session re-render with the extended array. The array reference
 * changes on every publish so React's `useSyncExternalStore` snapshot
 * comparison picks up the change.
 */
export function publishSessionEvent(sessionId: string, event: DashboardEvent): void {
  const current = events.get(sessionId) ?? EMPTY_EVENTS;
  events.set(sessionId, Object.freeze([...current, event]));
  notify(sessionId);
}

/**
 * Publish a batch of events for a session in one shot: a single array
 * rebuild plus a single notify. Used by the `event_replay` cold-load path
 * so plugin slot consumers rehydrate without N separate appends (O(N)
 * instead of O(N²) per-append) or N subscriber notifications. No-op for an
 * empty batch (preserves the stable reference). See change:
 * replay-persisted-flow-runs.
 */
export function publishSessionEvents(sessionId: string, newEvents: readonly DashboardEvent[]): void {
  if (newEvents.length === 0) return;
  const current = events.get(sessionId) ?? EMPTY_EVENTS;
  events.set(sessionId, Object.freeze([...current, ...newEvents]));
  notify(sessionId);
}

/**
 * Clear events for a session. Used on `session_state_reset` (the
 * shell's reducer also resets) so plugins re-derive from a fresh
 * stream after a replay.
 */
export function clearSessionEvents(sessionId: string): void {
  if (!events.has(sessionId)) return;
  events.delete(sessionId);
  notify(sessionId);
}

/**
 * Read events for a session. Returns a stable reference until the next
 * publish/clear for that session. Returns `EMPTY_EVENTS` (a frozen
 * empty array, also stable) for unknown sessions.
 *
 * @internal — consumed by `useSessionEvents` hook
 */
export function getSessionEvents(sessionId: string): readonly DashboardEvent[] {
  return events.get(sessionId) ?? EMPTY_EVENTS;
}

/**
 * Subscribe to changes for a single session. Returns an unsubscribe
 * function. The callback is invoked with no arguments after every
 * `publishSessionEvent` / `clearSessionEvents` for the matching
 * sessionId.
 *
 * @internal — consumed by `useSessionEvents` hook
 */
export function subscribeSessionEvents(sessionId: string, cb: () => void): () => void {
  let set = subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    subscribers.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(sessionId);
  };
}

function notify(sessionId: string): void {
  const set = subscribers.get(sessionId);
  if (!set) return;
  for (const cb of set) cb();
}

/**
 * Clear all events and subscribers. Test-only helper.
 *
 * @internal
 */
export function __resetSessionEventsStoreForTests(): void {
  events.clear();
  subscribers.clear();
}
