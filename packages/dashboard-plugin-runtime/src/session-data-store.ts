/**
 * Module-level per-session arbitrary key/value store for plugin-
 * accessible data that doesn't fit on `DashboardSession` and isn't
 * part of the event stream.
 *
 * Shape: `Map<sessionId, Map<key, value>>`. The shell publishes via
 * `publishSessionData(sessionId, key, value)`; plugins read via
 * `useSessionData<T>(sessionId, key)`. The value type is plugin-
 * specific; the store is type-erased at the boundary.
 *
 * Used today for `commandsList` (consumed by flows-plugin's gates and
 * actions). Future plugins may register their own keys; the namespace is
 * shared, so plugins SHOULD prefix keys with their plugin id
 * (e.g. `"flows:catalog"`).
 *
 * See change: pluginize-flows-via-registry; flows-dock-chip-and-panel-actions
 * (the flow list moved to the flows plugin's catalog event).
 */

const data = new Map<string, Map<string, unknown>>();
const subscribers = new Map<string, Set<() => void>>();
/**
 * Subscribers that fire on every publish for a given key, regardless of
 * session id. Callback receives `(sessionId, value)` and is invoked
 * synchronously after the per-(sessionId,key) store update. Used by
 * plugin-side caches (e.g. flows-plugin's per-session availability map)
 * that need to react to publishes for sessions they haven't observed yet.
 *
 * See change: add-flows-subcard.
 */
const keySubscribers = new Map<string, Set<(sessionId: string, value: unknown) => void>>();

/**
 * Publish a session-scoped data value under a string key. Plugins
 * subscribed to that (sessionId, key) pair re-render with the new
 * value. The value reference is stored verbatim; consumers should
 * treat it as immutable.
 */
export function publishSessionData<T>(sessionId: string, key: string, value: T): void {
  let session = data.get(sessionId);
  if (!session) {
    session = new Map();
    data.set(sessionId, session);
  }
  session.set(key, value);
  notify(sessionId, key);
  notifyKey(sessionId, key, value);
}

/**
 * Clear all data for a session. Used on session unregister.
 */
export function clearSessionData(sessionId: string): void {
  if (!data.has(sessionId)) return;
  const session = data.get(sessionId)!;
  const keys = Array.from(session.keys());
  data.delete(sessionId);
  for (const key of keys) {
    notify(sessionId, key);
    notifyKey(sessionId, key, undefined);
  }
}

/**
 * Read a session-scoped data value by key. Returns `undefined` for
 * unknown keys. Stable reference until the next `publishSessionData`
 * for the same (sessionId, key).
 *
 * @internal \u2014 consumed by `useSessionData` hook
 */
export function getSessionData<T>(sessionId: string, key: string): T | undefined {
  return data.get(sessionId)?.get(key) as T | undefined;
}

/**
 * Subscribe to changes for a single (sessionId, key) pair. Returns
 * an unsubscribe function. The callback is invoked with no arguments
 * after every `publishSessionData` for the matching pair (or after
 * `clearSessionData` for the session).
 *
 * @internal \u2014 consumed by `useSessionData` hook
 */
export function subscribeSessionData(
  sessionId: string,
  key: string,
  cb: () => void,
): () => void {
  const subKey = `${sessionId}\u0001${key}`;
  let set = subscribers.get(subKey);
  if (!set) {
    set = new Set();
    subscribers.set(subKey, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(subKey);
  };
}

function notify(sessionId: string, key: string): void {
  const subKey = `${sessionId}\u0001${key}`;
  const set = subscribers.get(subKey);
  if (!set) return;
  for (const cb of set) cb();
}

function notifyKey(sessionId: string, key: string, value: unknown): void {
  const set = keySubscribers.get(key);
  if (!set) return;
  for (const cb of set) cb(sessionId, value);
}

/**
 * Subscribe to publishes for a single `key` across every session. The
 * callback receives `(sessionId, value)` after each publish. When a
 * session is cleared via `clearSessionData`, the callback fires with
 * `value === undefined` for every key the session held.
 *
 * Used by plugin caches that need to populate state for sessions whose
 * data arrives at unpredictable times (e.g. flows-plugin's per-session
 * availability cache). Returns an unsubscribe function.
 *
 * See change: add-flows-subcard.
 */
export function subscribeSessionDataKey(
  key: string,
  cb: (sessionId: string, value: unknown) => void,
): () => void {
  let set = keySubscribers.get(key);
  if (!set) {
    set = new Set();
    keySubscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) keySubscribers.delete(key);
  };
}

/**
 * Test-only helper to reset the store between tests.
 *
 * @internal
 */
export function __resetSessionDataStoreForTests(): void {
  data.clear();
  subscribers.clear();
  keySubscribers.clear();
}
