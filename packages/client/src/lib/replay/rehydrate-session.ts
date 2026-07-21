/**
 * Rehydrate a session's reduced chat state + replay cursor from the durable
 * replay cache (Strategy A). On a cache hit, re-reduce the persisted RAW events
 * (design.md 1.1) into a `SessionState` so the chat paints instantly, and return
 * the cursor so the caller subscribes with `lastSeq = persistedMaxSeq` (delta
 * replay) instead of `lastSeq: 0` (full replay).
 *
 * The reducer is pure, so re-reducing on load is one synchronous pass over the
 * in-memory event tail — negligible for typical sessions.
 *
 * See change: reduce-session-replay-traffic.
 */
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";
import type { CachedEvent, ReplayCache } from "./replay-cache.js";

export interface RehydratedSession {
  /** Subscribe with this as `lastSeq` so the server delta-replays only the tail. */
  lastSeq: number;
  /** Provisional reduced state painted before the delta arrives. */
  state: SessionState;
  /** Raw event tail, re-seeded into the live buffer so appends continue. */
  events: CachedEvent[];
}

export async function rehydrateSession(
  sessionId: string,
  cache: ReplayCache,
): Promise<RehydratedSession | null> {
  const entry = await cache.get(sessionId);
  if (!entry) return null;
  // Fault-isolation: this re-reduce runs at App level, ABOVE every React
  // error boundary, so an uncaught throw on one malformed cached event would
  // unmount the whole app (black screen). The cache is an optimization only:
  // on any re-reduce failure, discard the poisoned entry (so it cannot
  // re-poison a later load) and return a cache miss, degrading to a full
  // replay (lastSeq: 0) exactly as a genuine miss does.
  // See change: fix-reducer-crash-undefined-toolname.
  try {
    let state = createInitialState();
    for (const { event } of entry.payload) {
      state = reduceEvent(state, event);
    }
    return { lastSeq: entry.maxSeq, state, events: entry.payload };
  } catch (err) {
    console.warn(
      `[rehydrate] re-reduce failed for session ${sessionId}; discarding replay-cache entry and falling back to full replay`,
      err,
    );
    await cache.delete(sessionId).catch(() => {});
    return null;
  }
}
