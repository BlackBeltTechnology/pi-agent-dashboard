/**
 * Slot-claim predicates for the jj-plugin.
 *
 * Per design Decision 2 (`add-jj-workspace-plugin`), every slot claim that
 * produces UI is gated through one of these predicates. When `jj` isn't
 * installed, the bridge probe never populates `Session.jjState`, so each
 * predicate naturally returns `false` and the plugin renders nothing.
 *
 * Pure functions — no React, no DOM, easy to unit-test exhaustively.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * True iff the session's cwd is inside a jj repo (`.jj/` reachable AND
 * the bridge probe completed at least once). Drives `JjActionBar`'s
 * "+ Workspace" / "Fold back" / "Forget" buttons.
 */
export function isInJjRepo(session: DashboardSession | null | undefined): boolean {
  return session?.jjState?.isJjRepo === true;
}

/**
 * True iff the session is inside a jj workspace (any name, including
 * "default"). Drives the always-visible workspace-name badge.
 *
 * Currently equivalent to `isInJjRepo` since every jj repo has at least
 * one workspace; kept as a separate predicate so the badge can later
 * narrow to non-default-only without churning the manifest.
 */
export function isInJjWorkspace(session: DashboardSession | null | undefined): boolean {
  return Boolean(session?.jjState?.isJjRepo && session.jjState.workspaceName);
}

/**
 * True iff the session's cwd is a plain git repo (not yet jj-colocated).
 * Drives the opt-in "Enable jj workspaces" affordance. The settings-section
 * gate (`showInitColocatedSuggestion`) is applied INSIDE the component, not
 * here — predicates can't read plugin config.
 */
export function isInGitRepoButNotJj(
  session: DashboardSession | null | undefined,
): boolean {
  if (!session) return false;
  if (session.jjState?.isJjRepo) return false;
  return Boolean(session.gitBranch);
}
