/**
 * Pure worktree-action derivation, shared by `WorktreeActionsMenu` (composer
 * strip) and the session actions menu so both surfaces offer the same actions
 * with the same availability. The push / open-PR RUNNERS live in
 * `worktree-runners.ts` (code-split: they only run on a click).
 *
 * `deriveWorktreeActions` holds the per-PR-state rules (design D6 of
 * `add-worktree-lifecycle-actions`): no PR / closed → Push, Open PR (gh-gated),
 * Merge; open / draft → Push, Merge; merged → Push only when ahead. Close is
 * always offered. `blocked` mirrors the working-session gate (streaming ∨
 * retrying); Close is never blocked.
 *
 * See change: add-session-actions-flyout (D2).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

type WorktreeActionKey = "push" | "pr" | "merge" | "close";

interface WorktreeActionSpec {
  key: WorktreeActionKey;
  /** Inert while the session is working. */
  blocked: boolean;
}

export interface WorktreeActionsCtx {
  /** `gh` CLI probe result; `undefined` while pending (treated as unavailable). */
  ghAvailable?: boolean;
  /** streaming ∨ retrying. */
  working: boolean;
}

export interface WorktreeActions {
  push?: WorktreeActionSpec;
  /** Open PR (no open PR + `gh` available). */
  openPr?: WorktreeActionSpec;
  merge?: WorktreeActionSpec;
  close: WorktreeActionSpec;
  /** A PR exists for the branch (any state) — the menu offers View PR #N. */
  hasPr: boolean;
}

export function deriveWorktreeActions(session: DashboardSession, ctx: WorktreeActionsCtx): WorktreeActions | null {
  if (!session.gitWorktree) return null;
  const prState = session.gitPrNumber == null ? "none" : (session.gitPrState ?? "open");
  const noOpenPr = prState === "none" || prState === "closed";
  const spec = (key: WorktreeActionKey): WorktreeActionSpec => ({ key, blocked: key !== "close" && ctx.working });
  return {
    push: prState !== "merged" || (session.gitStatus?.ahead ?? 0) > 0 ? spec("push") : undefined,
    openPr: noOpenPr && ctx.ghAvailable === true ? spec("pr") : undefined,
    merge: prState !== "merged" ? spec("merge") : undefined,
    close: spec("close"),
    hasPr: session.gitPrNumber != null,
  };
}
