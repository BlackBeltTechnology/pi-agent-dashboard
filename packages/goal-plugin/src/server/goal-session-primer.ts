/**
 * Goal-session primer.
 *
 * When a session is linked to a goal — either spawned via the goal route's
 * `+ New session` path or linked to an existing running session — the
 * `@ricoyudog/pi-goal-hermes` extension only begins its pursuit loop once it
 * receives a `/goal <objective>` command in-session. Stamping `goalId` on the
 * session meta + linking it into the `GoalRecord` (the rest of the link flow)
 * is NOT enough: without this kickoff the session boots idle and never tries
 * to reach the goal target.
 *
 * This module builds the kickoff command(s) and primes a freshly-linked
 * session: it renames the session card to the goal objective, then dispatches
 * `/goal <objective>` so the loop starts.
 *
 * See change: prime-goal-linked-sessions.
 */
import type { GoalRecord } from "@blackbelt-technology/pi-dashboard-shared/types.js";

type GoalLike = Pick<GoalRecord, "objective"> & Partial<Pick<GoalRecord, "criteria">>;

/** Collapse internal whitespace and trim; returns "" when nothing usable remains. */
function oneLine(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Build the slash-command sequence that kicks off the pi-goal-hermes loop.
 * Returns `/goal <objective>` (the loop kickoff). Returns `[]` when the
 * objective is empty (nothing to pursue).
 */
export function buildGoalPrimerCommands(goal: GoalLike): string[] {
  const objective = oneLine(goal.objective);
  if (!objective) return [];
  return [`/goal ${objective}`];
}

/** Card title for a goal-linked session: the objective, single-line, capped. */
export function goalSessionTitle(goal: Pick<GoalRecord, "objective">): string {
  return oneLine(goal.objective).slice(0, 80);
}

/** Max verdict notes folded into a fresh-respawn re-prime summary. */
const REPRIME_VERDICTS = 8;

/**
 * Build the fresh-respawn re-prime CONTEXT the supervisor sends alongside the
 * `/goal <objective>` kickoff after a poisoned session is replaced by a fresh
 * driver. Carries the objective, criteria, and a bounded tail of the persisted
 * verdict history so the new driver resumes with the dashboard's accumulated
 * context (nothing already persisted is lost). Returns "" when there is no
 * useful context to send. See change: add-goal-session-supervisor (S11).
 */
export function buildGoalReprime(
  goal: Pick<GoalRecord, "objective"> & Partial<Pick<GoalRecord, "criteria" | "verdicts" | "totalTurnsUsed" | "budget">>,
): string {
  const objective = oneLine(goal.objective);
  if (!objective) return "";
  const lines: string[] = [];
  lines.push(`Resuming goal after a fresh restart. Objective: ${objective}`);
  const criteria = (goal.criteria ?? []).map((c) => oneLine(c.text)).filter(Boolean);
  if (criteria.length > 0) {
    lines.push("Success criteria:");
    for (const c of criteria) lines.push(`- ${c}`);
  }
  const verdicts = (goal.verdicts ?? []).slice(-REPRIME_VERDICTS);
  if (verdicts.length > 0) {
    lines.push("Recent judge verdicts (oldest first):");
    for (const v of verdicts) {
      const note = oneLine(v.note);
      lines.push(`- turn ${v.turn}: ${v.verdict}${note ? ` — ${note}` : ""}`);
    }
  }
  if (typeof goal.totalTurnsUsed === "number" && goal.totalTurnsUsed > 0) {
    const cap = goal.budget?.maxTurns;
    lines.push(`Turns used so far: ${goal.totalTurnsUsed}${cap ? ` / ${cap}` : ""}.`);
  }
  return lines.join("\n");
}

export interface GoalPrimerDeps {
  /** Dispatch a prompt line into the session (RPC `send_prompt`). */
  sendPrompt: (sessionId: string, text: string) => void;
  /** Apply a session-name update (in-memory + broadcast + pi rename). */
  renameSession: (sessionId: string, name: string) => void;
}

/**
 * Prime a freshly-linked session to pursue its goal: set the card title to the
 * objective, then dispatch the kickoff command(s) so the pi-goal-hermes
 * extension starts the loop. No-op when the objective is empty.
 */
export function primeGoalSession(deps: GoalPrimerDeps, sessionId: string, goal: GoalLike): void {
  const commands = buildGoalPrimerCommands(goal);
  if (commands.length === 0) return;
  const title = goalSessionTitle(goal);
  if (title) deps.renameSession(sessionId, title);
  for (const cmd of commands) deps.sendPrompt(sessionId, cmd);
}
