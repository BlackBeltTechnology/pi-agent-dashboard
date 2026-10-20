/**
 * Per-session bridge replay mode: membership, fallback exit timers, and the
 * bookkeeping a windowed, abortable exit flush needs.
 *
 * A bridge replay normally ends on `replay_complete`. For bridges that mark
 * replayed events (`event_forward.replay`) the timers here only bound WHEN the
 * exit work runs if `replay_complete` is lost; classification of a marked event
 * does not depend on them. For old, unmarked bridges they are the fallback:
 *   - idle: no processed bridge message for `idleMs` (one `setImmediate`
 *     re-check, so input already read from the socket is handled first);
 *   - cap: `capMs` after the register, whatever keeps arriving.
 * One record per session; a new `begin` cancels the previous register's timers,
 * so a stale timer can never end a newer replay.
 *
 * The record outlives the exit (skip flag + flush bookkeeping live on it) until
 * `release` (unregister / remove).
 *
 * See change: fix-large-session-resume-replay (D2).
 */

export type ReplayExitCause = "complete" | "idle" | "cap" | "unregister";

export const REPLAY_IDLE_MS = 5_000;
export const REPLAY_CAP_MS = 60_000;
/** Keepalive cadence for subscribers waiting on a bridge replay (= cold-load heartbeat). */
const REPLAY_KEEPALIVE_MS = 10_000;

type Timer = ReturnType<typeof setTimeout>;

interface ReplayRecord {
  active: boolean;
  idleTimer: Timer | null;
  capTimer: Timer | null;
  lastTouchAt: number;
  /** Register skipped the wipe: marked events are never inserted until the next `begin`. */
  skipped: boolean;
  flushEpoch: number;
  /** A wipe happened (or events were stored) and no flush has completed since. */
  flushPending: boolean;
  /** Subscribers waiting for the replay; each stops its keepalive. */
  waiters: Set<() => void>;
}

export interface ReplayExitControllerOptions {
  idleMs?: number;
  capMs?: number;
  keepaliveMs?: number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => Timer;
  clearTimeout?: (t: Timer) => void;
  setImmediate?: (fn: () => void) => void;
}

export interface ReplayExitController {
  /** Sessions in bridge replay mode. Membership is owned by this controller. */
  readonly replayingSessions: Set<string>;
  readonly keepaliveMs: number;
  /** Set by the owner of the exit work (`exitReplay`). Called once per exit. */
  setOnExit(fn: (sessionId: string, cause: ReplayExitCause) => void): void;
  begin(sessionId: string, opts: { skipped: boolean }): void;
  touch(sessionId: string): void;
  /** A marked event arrived after an exit: re-enter replay mode. Returns whether it did. */
  reopen(sessionId: string): boolean;
  /** `replay_complete`. No-op when the replay already exited. */
  complete(sessionId: string): void;
  /** Unregister / remove: exit with cause `unregister` (if active), drop the record. */
  release(sessionId: string): void;
  isSkipped(sessionId: string): boolean;
  isFlushPending(sessionId: string): boolean;
  /** Start a flush: stales any older flush, returns its staleness probe + completion. */
  startFlush(sessionId: string): { isStale: () => boolean; finish: () => void };
  /** Register a waiting subscriber. Returns an idempotent remover (does not call `stop`). */
  addWaiter(sessionId: string, stop: () => void): () => void;
}

export function createReplayExitController(opts: ReplayExitControllerOptions = {}): ReplayExitController {
  const idleMs = opts.idleMs ?? REPLAY_IDLE_MS;
  const capMs = opts.capMs ?? REPLAY_CAP_MS;
  const keepaliveMs = opts.keepaliveMs ?? REPLAY_KEEPALIVE_MS;
  const now = opts.now ?? (() => Date.now());
  const setT = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((t) => clearTimeout(t));
  const setImm = opts.setImmediate ?? ((fn) => { setImmediate(fn); });
  const replayingSessions = new Set<string>();
  const records = new Map<string, ReplayRecord>();
  let onExit: (sessionId: string, cause: ReplayExitCause) => void = () => {};

  function clearTimers(rec: ReplayRecord): void {
    if (rec.idleTimer) clearT(rec.idleTimer);
    if (rec.capTimer) clearT(rec.capTimer);
    rec.idleTimer = null;
    rec.capTimer = null;
  }

  function stopWaiters(rec: ReplayRecord): void {
    const waiters = [...rec.waiters];
    rec.waiters.clear();
    for (const stop of waiters) {
      try { stop(); } catch { /* a waiter must never break the exit */ }
    }
  }

  /** First exit wins: later ones find `active` false and no-op. */
  function exit(sessionId: string, rec: ReplayRecord, cause: ReplayExitCause): void {
    if (!rec.active) return;
    rec.active = false;
    clearTimers(rec);
    replayingSessions.delete(sessionId);
    // A subscriber was waiting on this replay: it must get the flush's terminal
    // batch even if nothing else marked a flush pending.
    if (rec.waiters.size > 0) rec.flushPending = true;
    stopWaiters(rec);
    onExit(sessionId, cause);
  }

  function armIdle(sessionId: string, rec: ReplayRecord, delay: number): void {
    if (rec.idleTimer) clearT(rec.idleTimer);
    rec.idleTimer = setT(() => {
      rec.idleTimer = null;
      if (!rec.active || records.get(sessionId) !== rec) return;
      // Let input already read from the socket be handled once, then re-check.
      setImm(() => {
        if (!rec.active || records.get(sessionId) !== rec) return;
        const quiet = now() - rec.lastTouchAt;
        if (quiet >= idleMs) exit(sessionId, rec, "idle");
        else armIdle(sessionId, rec, idleMs - quiet);
      });
    }, delay);
  }

  return {
    replayingSessions,
    keepaliveMs,
    setOnExit(fn) { onExit = fn; },

    begin(sessionId, { skipped }) {
      let rec = records.get(sessionId);
      if (!rec) {
        rec = { active: false, idleTimer: null, capTimer: null, lastTouchAt: 0, skipped: false, flushEpoch: 0, flushPending: false, waiters: new Set() };
        records.set(sessionId, rec);
      }
      clearTimers(rec);
      rec.active = true;
      rec.skipped = skipped;
      rec.flushEpoch++;
      if (!skipped) rec.flushPending = true;
      rec.lastTouchAt = now();
      replayingSessions.add(sessionId);
      armIdle(sessionId, rec, idleMs);
      const r = rec;
      rec.capTimer = setT(() => {
        r.capTimer = null;
        if (records.get(sessionId) === r) exit(sessionId, r, "cap");
      }, capMs);
    },

    touch(sessionId) {
      const rec = records.get(sessionId);
      if (rec?.active) rec.lastTouchAt = now();
    },

    reopen(sessionId) {
      const rec = records.get(sessionId);
      if (!rec || rec.active || rec.skipped) return false;
      rec.active = true;
      rec.flushPending = true;
      rec.lastTouchAt = now();
      replayingSessions.add(sessionId);
      armIdle(sessionId, rec, idleMs);
      return true;
    },

    complete(sessionId) {
      const rec = records.get(sessionId);
      if (rec) exit(sessionId, rec, "complete");
    },

    release(sessionId) {
      const rec = records.get(sessionId);
      if (!rec) return;
      rec.flushEpoch++;
      if (rec.active) exit(sessionId, rec, "unregister");
      else stopWaiters(rec);
      clearTimers(rec);
      records.delete(sessionId);
      replayingSessions.delete(sessionId);
    },

    isSkipped(sessionId) {
      return records.get(sessionId)?.skipped === true;
    },

    isFlushPending(sessionId) {
      return records.get(sessionId)?.flushPending === true;
    },

    startFlush(sessionId) {
      const rec = records.get(sessionId);
      if (!rec) return { isStale: () => false, finish: () => {} };
      const epoch = ++rec.flushEpoch;
      return {
        isStale: () => records.get(sessionId) !== rec || rec.flushEpoch !== epoch,
        finish: () => {
          if (records.get(sessionId) === rec && rec.flushEpoch === epoch) rec.flushPending = false;
        },
      };
    },

    addWaiter(sessionId, stop) {
      const rec = records.get(sessionId);
      if (!rec) return () => {};
      const r = rec;
      r.waiters.add(stop);
      return () => { r.waiters.delete(stop); };
    },
  };
}
