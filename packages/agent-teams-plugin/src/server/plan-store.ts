/**
 * Plan request store primitives (design D8): text bounds, id allocation, supersede and the 20-plan cap.
 * Pure functions over `Team.plans`; callers persist the result with `store.patchTeam`.
 * See change: add-agent-teams-templates-hooks.
 */
import { MAX_STORED_PLANS } from "../shared/constants.js";
import { countMailChars, countMailLines } from "../shared/mail-format.js";
import type { OpResult } from "../shared/protocol.js";
import { sanitizeText } from "../shared/text.js";
import type { PlanRequest } from "../shared/types.js";
import { effectivePlanMaxChars, effectivePlanMaxLines, type TeamsConfig } from "./config.js";
import { fail } from "./op-util.js";

export interface TextBounds {
  maxChars: number;
  maxLines: number;
}

/** The plan / decision-feedback bound: `min(planMaxChars, maxMessageChars − 500)` chars and 120 core-counted lines. */
export function planBounds(cfg: Pick<TeamsConfig, "planMaxChars" | "maxMessageChars">): TextBounds {
  return { maxChars: effectivePlanMaxChars(cfg), maxLines: effectivePlanMaxLines() };
}

/**
 * Validate and sanitise a plan or feedback text. Non-string ⇒ `invalid_args`; empty or whitespace-only ⇒
 * `invalid_args` unless `allowEmpty`; over the bound ⇒ `message_too_long`. Never truncates.
 */
export function boundedText(raw: unknown, bounds: TextBounds, opts: { allowEmpty?: boolean; what: string }): OpResult<string> {
  if (typeof raw !== "string") return fail("invalid_args", `${opts.what} must be a string`);
  const text = sanitizeText(raw, { keepNewlines: true });
  if (text.trim() === "") return opts.allowEmpty ? { ok: true, data: "" } : fail("invalid_args", `${opts.what} must not be empty`);
  const chars = countMailChars(text);
  const lines = countMailLines(text, { envelope: false });
  if (chars > bounds.maxChars || lines > bounds.maxLines) {
    return fail("message_too_long", `${opts.what} is ${chars} characters / ${lines} lines; the limit is ${bounds.maxChars} characters / ${bounds.maxLines} lines`, {
      maxChars: bounds.maxChars,
      maxLines: bounds.maxLines,
    });
  }
  return { ok: true, data: text };
}

/** Next per-team id `p<N>`: one above the highest stored number (the newest plan is never the one dropped). */
export function nextPlanId(plans: readonly PlanRequest[]): string {
  let max = 0;
  for (const p of plans) {
    const n = Number(p.id.slice(1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `p${max + 1}`;
}

/**
 * Append `plan`: a still-pending plan of the same member becomes `superseded`, then the store is trimmed to
 * `MAX_STORED_PLANS` by dropping the oldest non-pending plans. Pending plans are never dropped, so a store
 * holding only pending plans of other members stays above the cap (bounded by one pending plan per member).
 */
export function appendPlan(plans: readonly PlanRequest[], plan: PlanRequest, now: number): PlanRequest[] {
  const next = plans.map((p) => (p.member === plan.member && p.status === "pending" ? { ...p, status: "superseded" as const, decidedAt: now } : p));
  next.push(plan);
  while (next.length > MAX_STORED_PLANS) {
    const at = next.findIndex((p) => p.status !== "pending" && p !== plan);
    if (at < 0) break;
    next.splice(at, 1);
  }
  return next;
}

/** `plans` with one plan replaced by `patch` (a new array; the originals are not mutated). */
export function patchPlan(plans: readonly PlanRequest[], id: string, patch: Partial<PlanRequest>): PlanRequest[] {
  return plans.map((p) => (p.id === id ? { ...p, ...patch } : p));
}
