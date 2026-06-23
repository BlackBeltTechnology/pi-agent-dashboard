/**
 * Probe the `@ricoyudog/pi-goal-hermes` command surface to pick how much of a
 * goal's config (judge model, turn/spend budget, criteria) the dashboard can
 * push into the live loop.
 *
 * The extension is NOT vendored in this repo, so we cannot import its command
 * grammar. The probe takes a `GoalCommandSurface` descriptor — what the host
 * has detected the running extension accepts — and maps it to a tier. With no
 * descriptor (extension absent / unknown), it falls back to the safe tier.
 *
 * Tiers (design Decision 2):
 *   full                      — extension accepts `/goal config …`: push judge + budget.
 *   criteria-dashboard-budget — only `/goal <text>` + `/subgoal <text>`: criteria via
 *                               /subgoal, budget enforced dashboard-side, judge intent-only.
 *   intent-only               — unknown surface: record on GoalRecord, no loop coupling.
 *
 * Upgrade seam: when a future extension advertises `acceptsConfig`, `goalConfigCommand`
 * emits the config command; until then it returns null and the caller degrades.
 *
 * See change: sophisticate-goal-authoring-and-control (tasks 3.1, 3.2).
 */
import type { GoalBudget, GoalJudge } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type GoalCommandTier = "full" | "criteria-dashboard-budget" | "intent-only";

/** What the host detected the running extension's command surface accepts. */
export interface GoalCommandSurface {
  /** Extension accepts a structured config command (e.g. `/goal config …`). */
  acceptsConfig?: boolean;
  /** Extension accepts `/subgoal <text>` for criteria. */
  acceptsSubgoal?: boolean;
}

/** Map a detected command surface to a coupling tier. */
export function probeGoalCommandSurface(surface?: GoalCommandSurface | null): GoalCommandTier {
  if (!surface) return "intent-only";
  if (surface.acceptsConfig) return "full";
  if (surface.acceptsSubgoal) return "criteria-dashboard-budget";
  return "intent-only";
}

/**
 * Emit the structured config command for the `full` tier, or `null` when the
 * tier can't accept it (caller degrades to dashboard-side enforcement / intent).
 * Command grammar is provisional — the upgrade seam for a vendored extension.
 */
export function goalConfigCommand(
  tier: GoalCommandTier,
  config: { budget?: GoalBudget; judge?: GoalJudge },
): string | null {
  if (tier !== "full") return null;
  const parts: string[] = ["/goal config"];
  if (config.judge) parts.push(`--judge ${config.judge.provider}/${config.judge.modelId}`);
  if (config.budget?.maxTurns !== undefined) parts.push(`--max-turns ${config.budget.maxTurns}`);
  if (config.budget?.maxSpendUsd !== undefined) parts.push(`--max-spend ${config.budget.maxSpendUsd}`);
  if (parts.length === 1) return null; // nothing to configure
  return parts.join(" ");
}

/** True when the chosen tier requires the dashboard to enforce budget itself. */
export function tierEnforcesBudgetDashboardSide(tier: GoalCommandTier): boolean {
  return tier === "criteria-dashboard-budget";
}
