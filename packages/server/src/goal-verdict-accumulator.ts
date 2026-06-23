/**
 * goal-verdict-accumulator — main-server consumer of `goal_status` snapshots
 * that appends a bounded judge-verdict history to the owning `GoalRecord`.
 *
 * The goal-plugin server can't reach the `GoalStore` (its `ServerPluginContext`
 * exposes no store surface), so verdict retention lives here, in the server
 * that owns the store + the `sessionId → goalId/cwd` mapping. Wired as a
 * `pluginPiHandlers["goal_status"]` consumer alongside the plugin's own
 * snapshot handler.
 *
 * A verdict is appended only when a goal's driver session's snapshot
 * **advances** — `turnsUsed` increases or `lastVerdict` changes — so a stream
 * of identical snapshots doesn't grow the record. Append is fire-and-forget
 * (store FIFO-caps at `GOAL_VERDICTS_CAP`); errors are logged, never thrown.
 *
 * See change: sophisticate-goal-authoring-and-control (Decision 3).
 */
import type { GoalVerdict } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { GoalStore } from "./goal-store.js";

/** Minimal snapshot fields the accumulator reads. */
interface GoalStatusSnapshotLike {
  status: string;
  turnsUsed: number;
  maxTurns: number;
  lastVerdict: string | null;
  lastReason: string | null;
}

interface GoalStatusMessage {
  sessionId?: string;
  payload?: GoalStatusSnapshotLike;
}

/** Resolve a session's owning goal + folder. Returns `null` when unlinked. */
export type SessionGoalLookup = (sessionId: string) => { goalId?: string; cwd?: string } | null;

export interface GoalVerdictAccumulatorDeps {
  store: GoalStore;
  lookupSession: SessionGoalLookup;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable logger; defaults to console.warn. */
  warn?: (msg: string, err: unknown) => void;
}

/** Map a live snapshot to a durable verdict kind. */
function verdictKind(status: string): GoalVerdict["verdict"] {
  if (status === "paused") return "paused";
  if (status === "done") return "satisfied";
  return "continue";
}

export interface GoalVerdictAccumulator {
  /** Handle one `goal_status` message ({ sessionId, payload }). */
  handle(msg: unknown): void;
}

export function createGoalVerdictAccumulator(deps: GoalVerdictAccumulatorDeps): GoalVerdictAccumulator {
  const { store, lookupSession } = deps;
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? ((m, e) => console.warn(m, e));

  // Per-session last-seen advance key, so repeated identical snapshots no-op.
  const lastSeen = new Map<string, { turnsUsed: number; lastVerdict: string | null }>();

  function handle(msg: unknown): void {
    const m = msg as GoalStatusMessage;
    if (!m.sessionId || !m.payload || typeof m.payload.status !== "string") return;
    if (typeof m.payload.turnsUsed !== "number" || !Number.isFinite(m.payload.turnsUsed)) return;
    const { sessionId, payload } = m;

    // A cleared loop resets tracking so a future run starts fresh.
    if (payload.status === "cleared") {
      lastSeen.delete(sessionId);
      return;
    }

    const link = lookupSession(sessionId);
    if (!link?.goalId || !link.cwd) return;

    const prev = lastSeen.get(sessionId);
    const advanced =
      !prev || payload.turnsUsed > prev.turnsUsed || payload.lastVerdict !== prev.lastVerdict;
    if (!advanced) return;
    lastSeen.set(sessionId, { turnsUsed: payload.turnsUsed, lastVerdict: payload.lastVerdict });

    const verdict: GoalVerdict = {
      turn: payload.turnsUsed,
      at: now(),
      verdict: verdictKind(payload.status),
      ...(payload.lastVerdict ? { note: payload.lastVerdict } : payload.lastReason ? { note: payload.lastReason } : {}),
    };

    store.appendVerdict(link.cwd, link.goalId, verdict).catch((err) => {
      warn(`[goal-verdict-accumulator] failed to append verdict for goal ${link.goalId}:`, err);
    });
  }

  return { handle };
}
