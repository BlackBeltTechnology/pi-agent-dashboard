/**
 * Build the `.meta.json` payload from an in-memory `DashboardSession`.
 *
 * This is the EXPLICIT field enumeration the debounced persistence save
 * (`metaPersistence.save`) performs as a FULL overwrite (not a merge). Any
 * dashboard-owned field omitted here is silently WIPED on the next save of any
 * other field. Extracted from `server.ts` `sessionManager.onChange` so the
 * enumeration is unit-testable (the wipe-regression guard).
 * See change: add-session-tags.
 */
import type { SessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function sessionToMeta(session: DashboardSession): SessionMeta {
  return {
    source: session.source,
    name: session.name,
    // Persist name provenance. MUST be listed here because this save does a
    // full .meta.json overwrite (not a merge) — omitting it wipes the auto/user
    // lockout signal on the next unrelated save. See change: add-auto-session-naming.
    nameSource: session.nameSource,
    attachedProposal: session.attachedProposal,
    displayPrefsOverride: session.displayPrefsOverride,
    processDrawerCollapsed: session.processDrawerCollapsed,
    hidden: session.hidden,
    cwd: session.cwd,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    tokensIn: session.tokensIn,
    tokensOut: session.tokensOut,
    cacheRead: session.cacheRead,
    cacheWrite: session.cacheWrite,
    cost: session.cost,
    contextTokens: session.contextTokens ?? undefined,
    contextWindow: session.contextWindow,
    firstMessage: session.firstMessage,
    // Persist unread bit so it survives server restart.
    // See change: session-card-unread-stripes.
    unread: session.unread,
    // Persist the worktree base ref so the WORKSPACE-subcard pill can
    // render `created from <base>` after restart. The field is only set
    // when a session was spawned via the dashboard's worktree dialog.
    // See change: add-worktree-spawn-dialog.
    gitWorktreeBase: session.gitWorktreeBase,
    // Persist the owning goal id so the session-card goal chip resolves its
    // goal after restart. MUST be listed here because this save does a full
    // .meta.json overwrite (not a merge) — omitting it wipes the field set
    // by event-wiring / goal routes. See change: add-goals-folder-page.
    goalId: session.goalId,
    // Persist the grouping-relevant worktree parentage so a rebooted
    // (bridge-less) scan can collapse this session under its parent repo.
    // Only the subset `resolveSessionGroupPath` needs is stored; volatile
    // probe state (worktree base) is excluded.
    // See change: fix-cold-start-worktree-session-grouping.
    gitWorktree: session.gitWorktree
      ? { mainPath: session.gitWorktree.mainPath, name: session.gitWorktree.name }
      : undefined,
    // Persist user-owned tags. MUST be listed here because this save does a
    // full .meta.json overwrite (not a merge) — omitting it wipes tags on the
    // next unrelated save. See change: add-session-tags.
    tags: session.tags,
    cachedAt: Date.now(),
  };
}
