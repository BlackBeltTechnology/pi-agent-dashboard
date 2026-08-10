/**
 * Review-gate decisions for ship-it step 4.5 (D1, D4, D10, D12).
 *
 * This module owns the DECISIONS; the skill owns the I/O (spawning the reviewer
 * subagent, timing it, writing SHIP_IT_BLOCKED.md). That split exists because
 * the two-round cap is the invariant that makes a model-in-the-loop ship-it
 * terminate, and as skill prose it was unverifiable by any test.
 *
 * Why a HARD cap rather than step 4's no-progress bound: step 4 stops only on a
 * cycle that changes nothing. A reviewer can emit a *fresh* blocking finding
 * every round; each fix changes the worktree, so every cycle registers as
 * progress and the no-progress rule never fires. A deterministic oracle (a test
 * goes green and stays green) does not have this shape; a model does.
 *
 * Pure + side-effect free. See change: wire-local-review-gate.
 */

/** Max reviewer rounds. Review, fix, re-review — never a third round. */
export const MAX_REVIEW_ROUNDS = 2;

/** Deadline per reviewer invocation (C1). A bounded round count does not bound wall-clock. */
export const REVIEW_TIMEOUT_MS = 300_000;

export type Severity =
  | "issue(blocking)"
  | "issue"
  | "suggestion"
  | "nit"
  | "question"
  | "praise";

export interface Finding {
  id: string;
  severity: Severity;
  note: string;
}

export interface ClassifiedFindings {
  blocking: Finding[];
  nonBlocking: Finding[];
}

/**
 * Only `issue(blocking)` re-enters the fix loop. Everything else is reported and
 * shipped — the gate is a ship gate, not a style tribunal.
 */
export function classifyFindings(findings: Finding[]): ClassifiedFindings {
  const blocking: Finding[] = [];
  const nonBlocking: Finding[] = [];
  for (const f of findings) {
    if (f.severity === "issue(blocking)") blocking.push(f);
    else nonBlocking.push(f);
  }
  return { blocking, nonBlocking };
}

export interface ReviewState {
  /** Rounds already completed. */
  round: number;
  blockingFindings: Finding[];
  /** The reviewer invocation exceeded REVIEW_TIMEOUT_MS. */
  timedOut?: boolean;
  /** Every candidate fix is rejected by assertNoWeakening. */
  unsatisfiable?: boolean;
}

export type ReviewAction = "review" | "proceed" | "escape";

export interface ReviewDecision {
  action: ReviewAction;
  /** Always populated for `escape` — it becomes the SHIP_IT_BLOCKED.md reason. */
  reason: string;
}

/**
 * The bound. Order matters: a timeout and an unsatisfiable finding both escape
 * regardless of the round counter, because neither can be resolved by looping.
 */
export function reviewRoundDecision(state: ReviewState): ReviewDecision {
  if (state.timedOut) {
    return {
      action: "escape",
      reason: `reviewer timed out after ${REVIEW_TIMEOUT_MS / 1000}s — not a pass, not a blocking finding`,
    };
  }

  if (state.unsatisfiable) {
    return {
      action: "escape",
      reason:
        "blocking finding is unsatisfiable under the no-weakening guardrail — " +
        "human adjudication required; the guardrail is never relaxed to reach green",
    };
  }

  if (state.blockingFindings.length === 0) {
    return { action: "proceed", reason: "no blocking findings" };
  }

  if (state.round >= MAX_REVIEW_ROUNDS) {
    return {
      action: "escape",
      reason:
        `blocking findings survived the hard cap of ${MAX_REVIEW_ROUNDS} review rounds: ` +
        state.blockingFindings.map((f) => f.id).join(", "),
    };
  }

  return { action: "review", reason: `round ${state.round + 1} of ${MAX_REVIEW_ROUNDS}` };
}

export interface ResolveReviewerInput {
  /** Role alias → model ref. */
  roles: Record<string, string>;
  /** The session's own model. Present only to prove it is never used as a fallback. */
  sessionDefault?: string;
  interactive: boolean;
}

export interface ResolveReviewerResult {
  ok: boolean;
  model?: string;
  error?: string;
  /** Offer the interactive bootstrap. Never persisted — accepting it removes the hard-fail. */
  prompt?: boolean;
}

/**
 * `@review` is REQUIRED. There is deliberately no fallback to the session
 * default: that model is the author, so falling back turns the gate into
 * self-review — which is exactly the failure mode this change exists to close.
 */
export function resolveReviewer(input: ResolveReviewerInput): ResolveReviewerResult {
  const model = input.roles.review;
  if (model) return { ok: true, model };

  return {
    ok: false,
    error:
      "@review role is not configured. ship-it's review checkpoint requires it and " +
      "will not fall back to the session default model (that would be self-review). " +
      "Assign it with the `update_roles` tool or the dashboard Roles panel — " +
      "seeding it from an existing @propose-review-N entry is usually right.",
    prompt: input.interactive,
  };
}
