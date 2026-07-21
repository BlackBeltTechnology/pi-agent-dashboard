/**
 * Pure helpers for the idempotent attach/detach auto-rename rule.
 *
 * See change: fix-mobile-attach-proposal-display (design.md decision matrix).
 *
 * Auto-rename on attach when EITHER (a) name is empty/whitespace, OR
 * (b) name === current attachedProposal (auto-set on a prior attach;
 * user has not customised, so re-track the new attachment).
 *
 * Auto-revert on detach only when name === attachedProposal (the witness
 * that the name was auto-set on a previous attach).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** True when the session's current name is the equality witness for "auto-set". */
export function isNameAutoSetFromAttachment(session: Pick<DashboardSession, "name" | "attachedProposal"> | undefined): boolean {
  if (!session) return false;
  const trimmed = session.name?.trim();
  if (!trimmed) return false;
  if (!session.attachedProposal) return false;
  return trimmed === session.attachedProposal;
}

/**
 * Decide whether attaching `changeName` to `session` should also rename it.
 * Returns the new name to apply, or `undefined` if name should not change.
 */
export function attachRenameTarget(
  session: Pick<DashboardSession, "name" | "attachedProposal"> | undefined,
  changeName: string,
): string | undefined {
  if (!session) return undefined;
  const trimmed = session.name?.trim();
  if (!trimmed) return changeName;
  if (isNameAutoSetFromAttachment(session)) return changeName;
  return undefined;
}

/**
 * Decide whether detaching from `session` should clear the name.
 * Returns true when the name should be cleared (set to undefined).
 */
export function detachShouldClearName(
  session: Pick<DashboardSession, "name" | "attachedProposal"> | undefined,
): boolean {
  return isNameAutoSetFromAttachment(session);
}
