/**
 * goal-status-projector — main-server consumer of `goal_status` snapshots that
 * projects the live loop onto the owning `GoalRecord`'s durable status + turn
 * fields (`status`, `lastKnownTurnsUsed`, `totalTurnsUsed`, `lastProgressAt`).
 *
 * Peer of `goal-verdict-accumulator`: same input stream, same `goalId`
 * attribution (via the emitting session), same store. Registered as a second
 * `pluginPiHandlers["goal_status"]` consumer. Where the accumulator retains a
 * bounded verdict history, this projector keeps the record's live-state mirror
 * current so the board and any budget logic survive a reload/restart.
 *
 * Turn accounting is per-driver + cumulative (budget-truthful): each driver
 * session tracks its last-seen `turnsUsed`; `totalTurnsUsed` grows by the
 * non-negative delta only, so it never double-counts across drivers, and a
 * first-observed `turnsUsed > 0` (missed the zero baseline) still counts —
 * prior is treated as 0. `lastProgressAt` stamps only on a strict increase.
 * Status is written only when the mapped value actually changes (idempotent).
 * Writes are fire-and-forget; a dropped write self-heals on the next snapshot.
 *
 * See change: persist-goal-status-and-progress.
 */
import type { GoalRecordStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { GoalStore } from "./goal-store.js";

/** Minimal snapshot fields the projector reads. */
interface GoalStatusSnapshotLike {
  status: string;
  turnsUsed: number;
}

interface GoalStatusMessage {
  sessionId?: string;
  payload?: GoalStatusSnapshotLike;
}

/** Resolve a session's owning goal + folder. Returns `null` when unlinked. */
export type SessionGoalLookup = (sessionId: string) => { goalId?: string; cwd?: string } | null;

export interface GoalStatusProjectorDeps {
  store: GoalStore;
  lookupSession: SessionGoalLookup;
  /** Injectable logger; defaults to console.warn. */
  warn?: (msg: string, err: unknown) => void;
}

/** Map a live snapshot status to the durable `GoalRecordStatus`. Returns null
 *  for an unrecognised status (ignored — no projection). */
function mapStatus(status: string): GoalRecordStatus | null {
  switch (status) {
    case "active":
      return "pursuing";
    case "paused":
      return "paused";
    case "done":
      return "achieved";
    case "cleared":
      return "cleared";
    default:
      return null;
  }
}

export interface GoalStatusProjector {
  /** Handle one `goal_status` message ({ sessionId, payload }). */
  handle(msg: unknown): void;
}

export function createGoalStatusProjector(deps: GoalStatusProjectorDeps): GoalStatusProjector {
  const { store, lookupSession } = deps;
  const warn = deps.warn ?? ((m, e) => console.warn(m, e));

  // Per-driver (per-session) live-state tracking: last mapped status written and
  // last `turnsUsed` observed. In-memory only — after restart the first snapshot
  // re-establishes tracking and backfills the durable record.
  const perDriver = new Map<string, { status: GoalRecordStatus; turnsUsed: number }>();

  /** Validate + normalize a raw message. Returns null when it should be ignored. */
  function parse(msg: unknown): { sessionId: string; mapped: GoalRecordStatus; turnsUsed: number } | null {
    const m = msg as GoalStatusMessage;
    if (!m.sessionId || !m.payload || typeof m.payload.status !== "string") return null;
    const turnsUsed = m.payload.turnsUsed;
    if (typeof turnsUsed !== "number" || !Number.isFinite(turnsUsed)) return null;
    const mapped = mapStatus(m.payload.status);
    if (mapped === null) return null;
    return { sessionId: m.sessionId, mapped, turnsUsed };
  }

  function handle(msg: unknown): void {
    const parsed = parse(msg);
    if (!parsed) return;
    const { sessionId, mapped, turnsUsed } = parsed;

    const link = lookupSession(sessionId);
    if (!link?.goalId || !link.cwd) return;

    const prev = perDriver.get(sessionId);
    const prevTurns = prev?.turnsUsed ?? 0;
    const turnsDelta = Math.max(0, turnsUsed - prevTurns);
    const progressed = turnsUsed > prevTurns;
    const statusChanged = prev?.status !== mapped;
    const turnsChanged = !prev || turnsUsed !== prev.turnsUsed;

    perDriver.set(sessionId, { status: mapped, turnsUsed });

    // Nothing durable to update: same status and same turns as last snapshot.
    if (!statusChanged && !turnsChanged) return;

    store
      .applyStatus(link.cwd, link.goalId, {
        status: mapped,
        lastKnownTurnsUsed: turnsUsed,
        turnsDelta,
        progressed,
      })
      .catch((err) => {
        warn(`[goal-status-projector] failed to project status for goal ${link.goalId}:`, err);
      });
  }

  return { handle };
}
