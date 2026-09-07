/**
 * Pure derivation of the MEMORY subcard view model from ONE
 * `/api/plugins/blackhole/session/:id` response (design D6). Separated from
 * the component so every spec scenario is assertable without a DOM.
 *
 * Scenario anchors:
 *   E10 healthy / no-activity / workers-off / cooldown / pending-batches
 *   E11 exact cursor lag (tip − cursor), caught-up 0, stale-cursor boundary
 *   F5  proximity: approximate-only, unscaled, non-alarming
 *   F6  proximity omitted when `contextTokens` or `compactAfterTokens` missing
 *
 * See change: add-blackhole-session-pipeline.
 */
import type { WorkerId, WorkerCursorView, WorkerPipelineView, SessionPipelineResponse } from "./pipeline-api.js";

interface WorkerRow {
  id: WorkerId;
  /** Verbatim cursor state from the pending file, when present. */
  cursorState: string | null;
  /** True when the worker's primary model is on an active cooldown. */
  degraded: boolean;
  coolingModel: string | null;
  /** Whole minutes remaining on the cooldown, when actively cooling. */
  cooldownRemainingMin: number | null;
}

type LagReadout =
  | { kind: "exact"; lag: number }
  | { kind: "stale" }
  | null;

export interface SubcardViewModel {
  /** No pending file / torn file — "no pipeline activity yet" (distinct from workers-off). */
  noActivity: boolean;
  /** `memory: false` — workers off; compaction still runs; NO meter. */
  workersOff: boolean;
  workers: WorkerRow[];
  /** Exact cursor lag (E11) — null when no numeric cursors are recorded at rest. */
  lag: LagReadout;
  /**
   * Approximate compaction proximity — `contextTokens / compactAfterTokens`.
   * Present ONLY when both inputs exist (F6). Never rendered with numbers,
   * marks, or an alert (F5).
   */
  proximityFraction: number | null;
  /** Manual-mode advisory: pending batches awaiting a `/blackhole` flush. */
  pendingBatches: number;
}

export interface ProximityInputs {
  /** Dashboard's own token estimate for the session (`DashboardSession.contextTokens`). */
  contextTokens: number | null | undefined;
  compactAfterTokens: number | null;
}

function workerRow(
  id: WorkerId,
  cursor: WorkerCursorView | null,
  worker: WorkerPipelineView | null,
  now: number,
): WorkerRow {
  let degraded = false;
  let coolingModel: string | null = null;
  let cooldownRemainingMin: number | null = null;
  if (worker?.cooldown && worker.model) {
    const until = Date.parse(worker.cooldown.until);
    if (!Number.isNaN(until) && until > now) {
      degraded = true;
      coolingModel = worker.model;
      cooldownRemainingMin = Math.max(0, Math.ceil((until - now) / 60_000));
    }
  }
  return {
    id,
    cursorState: cursor?.state ?? null,
    degraded,
    coolingModel,
    cooldownRemainingMin,
  };
}

/**
 * Exact cursor lag across workers (E11): each numeric cursor vs the shared
 * tip. Any worker AHEAD of the tip (history truncated/compacted since the
 * cursor was written) dominates as the stale-cursor state — no numeric lag is
 * rendered for it. The reported lag is the LAGGARD's (max), never negative.
 */
function deriveLag(
  cursors: Record<WorkerId, WorkerCursorView | null>,
  tip: number | null,
): LagReadout {
  if (tip === null || !Number.isFinite(tip)) return null;
  let hasNumeric = false;
  let maxLag: number | null = null;
  let stale = false;
  for (const cursor of Object.values(cursors)) {
    const entry = cursor?.entry;
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    hasNumeric = true;
    if (entry > tip) {
      stale = true;
    } else {
      const lag = tip - entry;
      maxLag = maxLag === null ? lag : Math.max(maxLag, lag);
    }
  }
  if (!hasNumeric) return null;
  if (stale) return { kind: "stale" };
  return { kind: "exact", lag: maxLag ?? 0 };
}

/**
 * Approximate proximity (F5/F6): the dashboard's `contextTokens` measured
 * against the configured `compactAfterTokens`. Either input missing → null
 * (the meter is omitted; worker indicators + lag still render). The value is
 * a raw fraction for an UNSCALED fill — it is never displayed as a number,
 * percentage, or threshold position, and never drives an alert.
 */
function deriveProximity(inputs: ProximityInputs): number | null {
  if (inputs.compactAfterTokens === null || inputs.compactAfterTokens <= 0) return null;
  const ctx = inputs.contextTokens;
  if (typeof ctx !== "number" || !Number.isFinite(ctx) || ctx < 0) return null;
  return ctx / inputs.compactAfterTokens;
}

export function deriveSubcardState(
  response: SessionPipelineResponse,
  inputs: ProximityInputs,
  now: number = Date.now(),
): SubcardViewModel {
  const workersOff = response.config.memory === false;
  const workers = (["observer", "reflector", "dropper"] as const).map((id) =>
    workerRow(id, response.cursors[id], response.workers[id], now),
  );
  return {
    noActivity: response.activity === "none",
    workersOff,
    workers,
    lag: deriveLag(response.cursors, response.tip),
    proximityFraction: deriveProximity(inputs),
    pendingBatches: response.pendingBatches,
  };
}
