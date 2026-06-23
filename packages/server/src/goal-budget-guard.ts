/**
 * Dashboard-side budget enforcement for the goal loop.
 *
 * When the `@ricoyudog/pi-goal-hermes` command surface can't accept budget
 * config (degraded tier — see goal-plugin/src/server/probe.ts), the dashboard
 * enforces the `GoalRecord.budget` itself: once a driver session's live
 * `turnsUsed` reaches the configured `maxTurns`, the server dispatches
 * `/goal pause` into the session to halt continuation past the cap.
 *
 * Pure decision so it's unit-testable against a stub. The caller owns the
 * actual dispatch + dedupe (don't re-pause an already-paused loop).
 *
 * See change: sophisticate-goal-authoring-and-control (task 3.2).
 */
import type { GoalBudget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface BudgetGuardSnapshot {
  status: string;
  turnsUsed: number;
}

export interface BudgetHaltDecision {
  halt: boolean;
  /** Command to dispatch when `halt` is true. */
  command?: string;
}

/**
 * Decide whether to halt the loop for budget. Halts only when an active loop's
 * `turnsUsed` has reached `budget.maxTurns`. A paused/done/cleared loop, or an
 * absent / zero / non-finite cap, never halts.
 */
export function decideBudgetHalt(
  snapshot: BudgetGuardSnapshot,
  budget: GoalBudget | undefined,
): BudgetHaltDecision {
  if (!budget || snapshot.status !== "active") return { halt: false };
  const cap = budget.maxTurns;
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return { halt: false };
  if (snapshot.turnsUsed < cap) return { halt: false };
  return { halt: true, command: "/goal pause" };
}
