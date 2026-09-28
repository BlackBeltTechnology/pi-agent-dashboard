/**
 * Merge-emphasis rule: is the worktree's Merge this surface's ONE filled
 * primary action? Evaluated once per surface (session card, composer strip)
 * and passed down to both the Git actions (fills Merge) and the OpenSpec
 * actions (outlines their primary).
 *
 * True iff ALL hold:
 * - the session is in a worktree;
 * - the PR is open and not a draft;
 * - checks are passing, or there is no CI (`none`);
 * - the PR status is fresh (checked within the last 15 min);
 * - the session is not working (a disabled Merge is never the primary);
 * - no change is attached, or the attached change is COMPLETE
 *   (attached with an unknown state ⇒ false).
 *
 * See change: redesign-composer-session-strip (D6).
 */
import { ChangeState, type GitPrChecks, type GitPrState } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const PR_STATUS_FRESH_MS = 15 * 60_000;

export interface MergePrimaryInput {
  hasWorktree: boolean;
  prState?: GitPrState | null;
  prDraft?: boolean | null;
  prChecks?: GitPrChecks | null;
  prCheckedAt?: number | null;
  working: boolean;
  /** A change is attached to the session. */
  attached: boolean;
  /** Derived state of the attached change; `undefined` = unknown / not found. */
  attachedChangeState?: ChangeState;
  now?: number;
}

export function isMergePrimary(i: MergePrimaryInput): boolean {
  if (!i.hasWorktree || i.working) return false;
  if (i.prState !== "open" || i.prDraft === true) return false;
  if (i.prChecks !== "passing" && i.prChecks !== "none") return false;
  if (i.prCheckedAt == null || (i.now ?? Date.now()) - i.prCheckedAt > PR_STATUS_FRESH_MS) return false;
  return !i.attached || i.attachedChangeState === ChangeState.COMPLETE;
}

/** Is the stored PR status older than the freshness window? */
export function isPrStatusStale(prCheckedAt: number | null | undefined, now = Date.now()): boolean {
  return prCheckedAt != null && now - prCheckedAt > PR_STATUS_FRESH_MS;
}
