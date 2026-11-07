/**
 * Honest Stop outcome helpers shared by the engine's live Stop and the orphan
 * Stop pipeline (dependency-free so the plugin entry stays cheap to load).
 * See change: polish-automation-board (design D4).
 */
import type { StopOutcome } from "../shared/automation-types.js";

/** Record reason written for a stopped run, by outcome (design D4). */
export function reasonFor(outcome: StopOutcome): string {
  if (outcome === "killed") return "stopped by user";
  if (outcome === "not-found") return "stopped by user; no session was found to terminate";
  return "stopped by user; process may still be running";
}

/** Reason for a Stop that landed before the run's session registered. */
export const SPAWN_WINDOW_STOP_REASON =
  "stop requested before the session registered; process may still be running";

/**
 * Parent outcome from its children's (design D4): `killed` only when every
 * child was killed, `not-found` only when every child was not-found (or there
 * were none), otherwise `unconfirmed`.
 */
export function combineOutcomes(outcomes: StopOutcome[]): StopOutcome {
  if (outcomes.length === 0 || outcomes.every((o) => o === "not-found")) return "not-found";
  if (outcomes.every((o) => o === "killed")) return "killed";
  return "unconfirmed";
}
