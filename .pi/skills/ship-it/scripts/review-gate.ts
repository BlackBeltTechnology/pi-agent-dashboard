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
 * Pure + side-effect free. See change: wire-local-review-gate,
 * harden-review-and-fix-loop (human continuation at the cap, reply parsing,
 * malformed-retry and ledger-failure bounds).
 */

/**
 * Base review-round cap: review, fix, re-review. Raised only by one round per
 * human approval recorded at the cap (`approvedExtraRounds`) — never by the
 * orchestrator itself.
 */
export const MAX_REVIEW_ROUNDS = 2;

/** A second malformed reply for the same round halts like a timeout. */
export const MAX_MALFORMED_ATTEMPTS = 2;

/** The third failed validation of the same round's fix ledger ⇒ unsatisfiable. */
export const MAX_LEDGER_FAILURES = 3;

/**
 * The defect classes the reviewer sweeps across the whole change. Single source
 * for the generated prompt and the `review-code` rubric contract test — the
 * rubric must name each verbatim.
 */
export const DEFECT_CLASSES = [
  "Spec and task conformance",
  "Canonicalize before check",
  "Degenerate and boundary input",
  "Stale state and reconciliation",
  "Error-path cleanup",
  "Shared-helper blast radius",
  "Concurrency and interleaving",
  "Test fidelity",
] as const;

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
  /** True exactly when the `ask_user` tool is available. Default: headless. */
  interactive?: boolean;
  /** Lines in `approvals.log` — each written only right after an `ask_user` answer. */
  approvedExtraRounds?: number;
  /** Malformed-reply attempt files for the pending round. */
  malformedRetries?: number;
  /** Recorded fix-ledger validation failures for the pending round. */
  ledgerFailures?: number;
}

export type ReviewAction = "review" | "proceed" | "escape" | "ask";

export interface ReviewDecision {
  action: ReviewAction;
  /** Always populated for `escape` — it becomes the SHIP_IT_BLOCKED.md reason. */
  reason: string;
}

/**
 * The bound. Order matters: a timeout and an unsatisfiable finding both escape
 * regardless of the round counter, because neither can be resolved by looping.
 *
 * At the cap an interactive run gets `ask` (one more verification round, or hand
 * back); only the recorded answer raises the ceiling, by exactly one. The
 * function never lowers `round`, so there is no input that renews a budget.
 */
export function reviewRoundDecision(state: ReviewState): ReviewDecision {
  const ids = state.blockingFindings.map((f) => f.id).join(", ");
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

  if ((state.ledgerFailures ?? 0) >= MAX_LEDGER_FAILURES) {
    return {
      action: "escape",
      reason:
        `fix ledger failed validation ${MAX_LEDGER_FAILURES} times for the pending round — ` +
        `blocking finding(s) ${ids || "(none listed)"} are unsatisfiable within the ledger bound`,
    };
  }

  const malformed = state.malformedRetries ?? 0;
  if (malformed >= MAX_MALFORMED_ATTEMPTS) {
    return {
      action: "escape",
      reason: `reviewer returned ${malformed} malformed replies for the same round — halted like a timeout`,
    };
  }
  if (malformed > 0) {
    return { action: "review", reason: "previous reply was malformed — one re-invocation of the same round" };
  }

  // No round has run yet: "no findings" means "not reviewed", never "clean".
  if (state.round <= 0) {
    return { action: "review", reason: "round 1 \u2014 no review has run yet" };
  }

  if (state.blockingFindings.length === 0) {
    return { action: "proceed", reason: "no blocking findings" };
  }

  const ceiling = MAX_REVIEW_ROUNDS + Math.max(0, state.approvedExtraRounds ?? 0);
  if (state.round >= ceiling) {
    if (state.interactive) {
      return {
        action: "ask",
        reason: `round ceiling ${ceiling} reached with blocking findings: ${ids} — ask one more verification round or hand back`,
      };
    }
    return {
      action: "escape",
      reason: `blocking findings survived the hard cap of ${ceiling} review rounds: ${ids}`,
    };
  }

  return { action: "review", reason: `round ${state.round + 1} of ${ceiling}` };
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

export interface ParsedReviewReply {
  /** Distinct `B<n>` ids marked `issue(blocking)`, in first-seen order. */
  blockingIds: string[];
  /** The `BLOCKING_COUNT:` value, or null when absent/duplicated. */
  count: number | null;
  verdict: "pass" | "block" | null;
  /** A markdown table row naming at least one defect class. Advisory only. */
  hasSweepSummary: boolean;
  /** Never a pass and never a round — see `reviewRoundDecision` malformedRetries. */
  malformed: boolean;
}

// Tolerate list bullets, emphasis and code ticks the reviewer may wrap lines in.
const LINE_LEAD = String.raw`^[\s>*\-_\`]*`;
const BLOCKING_RE = /issue\(blocking\)[*_`]*\s*:?\s*[*_`]*(B\d+)\b/g;
const COUNT_LINE_RE = new RegExp(`${LINE_LEAD}BLOCKING_COUNT\\b`, "gim");
const COUNT_VALUE_RE = new RegExp(`${LINE_LEAD}BLOCKING_COUNT[*_\`]*\\s*:\\s*[*_\`]*(\\d+)`, "im");
const VERDICT_LINE_RE = new RegExp(`${LINE_LEAD}VERDICT\\b`, "gim");
const VERDICT_VALUE_RE = new RegExp(`${LINE_LEAD}VERDICT[*_\`]*\\s*:\\s*[*_\`]*(pass|block)\\b`, "im");

/**
 * Turn a reviewer reply into the only facts ship-it keys on. Fails CLOSED: a
 * reply that is empty, has no/duplicate trailer lines, or contradicts itself
 * (lists `B1` yet says `BLOCKING_COUNT: 0`; count 0 yet `VERDICT: block`) is
 * malformed — never routed as a pass.
 */
export function parseReviewReply(text: string): ParsedReviewReply {
  const blockingIds = [...new Set([...text.matchAll(BLOCKING_RE)].map((m) => m[1]))];
  const countLines = text.match(COUNT_LINE_RE)?.length ?? 0;
  const verdictLines = text.match(VERDICT_LINE_RE)?.length ?? 0;
  const countMatch = countLines === 1 ? COUNT_VALUE_RE.exec(text) : null;
  const verdictMatch = verdictLines === 1 ? VERDICT_VALUE_RE.exec(text) : null;
  const count = countMatch ? Number(countMatch[1]) : null;
  const verdict = verdictMatch ? (verdictMatch[1].toLowerCase() as "pass" | "block") : null;
  const classes = DEFECT_CLASSES.map((c) => c.toLowerCase());
  const hasSweepSummary = text
    .split("\n")
    .some((l) => l.trimStart().startsWith("|") && classes.some((c) => l.toLowerCase().includes(c)));

  const malformed =
    text.trim() === "" ||
    count === null ||
    verdict === null ||
    count !== blockingIds.length ||
    verdict !== (count === 0 ? "pass" : "block");

  return { blockingIds, count, verdict, hasSweepSummary, malformed };
}
