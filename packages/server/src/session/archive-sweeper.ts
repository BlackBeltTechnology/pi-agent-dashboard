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
 * See change: archive-sessions-lazy-load.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getConfigSnapshot } from "../config-snapshot.js";
import type { SessionManager } from "./memory-session-manager.js";
import type { SessionArchive } from "./session-archive.js";

/** Max sessions archived in a single tick (oldest first). */
const SWEEP_BATCH_CAP = 200;

export interface ArchiveSweeperDeps {
  sessionManager: SessionManager;
  sessionArchive: SessionArchive;
  /** True while at least one connected browser is viewing the session. */
  isViewed: (sessionId: string) => boolean;
  /** Live config read. Defaults to `getConfigSnapshot`. */
  getConfig?: () => { sessionList: { archiveAfterDays: number; archiveSweepIntervalMinutes: number } };
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
}

export function createArchiveSweeper(deps: ArchiveSweeperDeps): ArchiveSweeper {
  const { sessionManager, sessionArchive, isViewed } = deps;
  const getConfig = deps.getConfig ?? (() => getConfigSnapshot());
  const now = deps.now ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = deps.clearIntervalFn ?? ((h) => clearInterval(h));

  let handle: ReturnType<typeof setInterval> | null = null;
  let armedIntervalMs: number | null = null;

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
      if (handle !== null) return;
      const config = getConfig();
      const intervalMs = Math.max(1, config.sessionList.archiveSweepIntervalMinutes) * 60_000;
      armedIntervalMs = intervalMs;
      handle = setIntervalFn(() => { tick(); }, intervalMs);
    },
    stop() {
      if (handle !== null) clearIntervalFn(handle);
      handle = null;
      armedIntervalMs = null;
    },
    tick,
  };
}
