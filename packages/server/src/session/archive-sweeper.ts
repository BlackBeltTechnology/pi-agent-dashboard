/**
 * Runtime auto-archive sweeper.
 *
 * A plain `setInterval` that reads the live config on every tick (no restart,
 * no scheduler abstraction) and archives ended sessions whose reference age
 * `max(endedAt, restoredAt)` exceeds `sessionList.archiveAfterDays`. The boot
 * scan already archives everything past the threshold, so a tick normally
 * touches only sessions that crossed it while the server ran.
 *
 * Capped at 200 sessions per tick, oldest first, so a live threshold drop
 * (30 → 7 d) drains over a few ticks instead of one synchronous write loop and
 * frame burst. `archiveAfterDays === 0` short-circuits. Currently-viewed
 * sessions are deferred to a later tick; `live === true` recovery candidates
 * are never archived.
 *
 * Also owns the on-end archive of sessions DECLARED disposable
 * (`archiveOnEnd`, set from a plugin's spawn lifecycle declaration):
 * `scheduleServiceArchive(id)` arms one `SERVICE_ARCHIVE_GRACE_MS` timer per
 * id; the fire re-validates eligibility (resident → ended → declared →
 * not live → not restored since scheduling → setting on → viewed ⇒ re-arm)
 * so plugin end-handlers that read the ended session finish first. `stop()`
 * clears every timer and latches the instance (no scheduling, no `start()`).
 *
 * See change: archive-sessions-lazy-load, archive-service-sessions-on-end.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getConfigSnapshot } from "../config-snapshot.js";
import type { SessionManager } from "./memory-session-manager.js";
import type { SessionArchive } from "./session-archive.js";

/** Max sessions archived in a single tick (oldest first). */
const SWEEP_BATCH_CAP = 200;

/** Delay between a declared-disposable session's end and its archive. */
export const SERVICE_ARCHIVE_GRACE_MS = 30_000;

export interface ArchiveSweeperDeps {
  sessionManager: SessionManager;
  sessionArchive: SessionArchive;
  /** True while at least one connected browser is viewing the session. */
  isViewed: (sessionId: string) => boolean;
  /** Live config read. Defaults to `getConfigSnapshot`. */
  getConfig?: () => {
    sessionList: {
      archiveAfterDays: number;
      archiveSweepIntervalMinutes: number;
      /** Absent ⇒ enabled (the config default). */
      archiveServiceSessionsOnEnd?: boolean;
    };
  };
  now?: () => number;
  /** Injectable timer facade for tests. */
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface ArchiveSweeper {
  start(): void;
  stop(): void;
  /** Run one tick synchronously (tests / diagnostics). */
  tick(): number;
  /**
   * Arm the graced on-end archive for a declared-disposable ended session.
   * Idempotent per id; no-op once stopped, when undeclared, not ended,
   * restored after its end, or the setting is off (not retroactive).
   */
  scheduleServiceArchive(sessionId: string): void;
  /** Pending on-end archive timers (tests / diagnostics). */
  pendingServiceArchiveCount(): number;
}

export function createArchiveSweeper(deps: ArchiveSweeperDeps): ArchiveSweeper {
  const { sessionManager, sessionArchive, isViewed } = deps;
  const getConfig = deps.getConfig ?? (() => getConfigSnapshot());
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h));

  let handle: ReturnType<typeof setInterval> | null = null;
  let armedIntervalMs: number | null = null;
  // Per-instance stopped latch: bridge teardown during shutdown ends sessions
  // (→ onEnded → schedule) and `start()` runs in an async discovery `.then`.
  let stopped = false;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const serviceArchiveEnabled = (): boolean =>
    getConfig().sessionList.archiveServiceSessionsOnEnd !== false;

  function arm(sessionId: string, scheduledAt: number): void {
    const timer = setTimeout(() => fireServiceArchive(sessionId, scheduledAt), SERVICE_ARCHIVE_GRACE_MS);
    timer.unref?.();
    pending.set(sessionId, timer);
  }

  /**
   * Fire-time verdict, checks in order: resident → ended → declared → not
   * live → not restored since scheduling → setting on → viewed ⇒ re-arm.
   * Restore precedes view, so a restored + viewed session is dropped.
   */
  function fireVerdict(session: DashboardSession | undefined, scheduledAt: number): "drop" | "rearm" | "archive" {
    if (session?.status !== "ended" || session.archiveOnEnd !== true || session.live === true) return "drop";
    if (session.restoredAt !== undefined && session.restoredAt >= scheduledAt) return "drop";
    if (!serviceArchiveEnabled()) return "drop";
    return isViewed(session.id) ? "rearm" : "archive";
  }

  function fireServiceArchive(sessionId: string, scheduledAt: number): void {
    pending.delete(sessionId);
    if (stopped) return;
    const verdict = fireVerdict(sessionManager.get(sessionId), scheduledAt);
    if (verdict === "rearm") arm(sessionId, scheduledAt);
    if (verdict !== "archive") return;
    const result = sessionArchive.archiveSession(sessionId, "service-end");
    if (result.ok) console.info(`[archive] service-end archived ${sessionId}`);
  }

  function tick(): number {
    const config = getConfig();
    const days = config.sessionList.archiveAfterDays;
    const intervalMs = Math.max(1, config.sessionList.archiveSweepIntervalMinutes) * 60_000;
    // Re-arm when the interval changed (no restart required).
    if (handle !== null && armedIntervalMs !== null && armedIntervalMs !== intervalMs) {
      clearIntervalFn(handle);
      handle = setIntervalFn(() => { tick(); }, intervalMs);
      armedIntervalMs = intervalMs;
    }
    if (days <= 0) return 0;

    const cutoff = now() - days * 86_400_000;
    const eligible: DashboardSession[] = [];
    for (const session of sessionManager.listAll()) {
      if (session.status !== "ended") continue;
      if (session.live === true) continue;
      if (isViewed(session.id)) continue;
      const reference = Math.max(session.endedAt ?? 0, session.restoredAt ?? 0);
      if (reference < cutoff) eligible.push(session);
    }
    if (eligible.length === 0) return 0;

    eligible.sort((a, b) => {
      const ra = Math.max(a.endedAt ?? 0, a.restoredAt ?? 0);
      const rb = Math.max(b.endedAt ?? 0, b.restoredAt ?? 0);
      return ra - rb;
    });
    const batch = eligible.slice(0, SWEEP_BATCH_CAP);
    const startedMs = now();
    let archived = 0;
    for (const session of batch) {
      const result = sessionArchive.archiveSession(session.id, "sweep");
      if (result.ok) archived++;
    }
    if (archived > 0) {
      console.info(`[archive] sweep archived ${archived} session(s) in ${now() - startedMs} ms`);
    }
    return archived;
  }

  return {
    start() {
      if (stopped || handle !== null) return;
      const config = getConfig();
      const intervalMs = Math.max(1, config.sessionList.archiveSweepIntervalMinutes) * 60_000;
      armedIntervalMs = intervalMs;
      handle = setIntervalFn(() => { tick(); }, intervalMs);
    },
    stop() {
      stopped = true;
      if (handle !== null) clearIntervalFn(handle);
      handle = null;
      armedIntervalMs = null;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
    tick,
    scheduleServiceArchive(sessionId) {
      if (stopped || pending.has(sessionId)) return;
      const session = sessionManager.get(sessionId);
      if (session?.archiveOnEnd !== true || session.status !== "ended") return;
      // A re-notified end of a session restored from the archive: only a
      // genuine end AFTER the restore re-arms the rule.
      if (session.restoredAt !== undefined && session.restoredAt >= (session.endedAt ?? 0)) return;
      if (!serviceArchiveEnabled()) return;
      arm(sessionId, now());
    },
    pendingServiceArchiveCount: () => pending.size,
  };
}
