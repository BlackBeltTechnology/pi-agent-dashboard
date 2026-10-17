/**
 * Pure worktree-action derivation + the push / open-PR runners, shared by
 * `WorktreeActionsMenu` (composer strip) and the session actions menu so both
 * surfaces offer the same actions with the same availability.
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
import { createWorktreePR, pushWorktreeBranch } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

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

/** Human-readable label for a stable error code returned by the lifecycle endpoints. */
export function labelForCode(code: string): string {
  switch (code) {
    case "no_remote":            return i18nT("worktree.errNoRemote", undefined, "no `origin` remote configured");
    case "auth_failed":          return i18nT("worktree.errAuthFailed", undefined, "git auth failed");
    case "non_fast_forward":     return i18nT("worktree.errNonFastForward", undefined, "remote has commits you don't have — pull first");
    case "gh_not_found":         return i18nT("worktree.errGhNotFound", undefined, "`gh` CLI not installed");
    case "gh_not_authed":        return i18nT("worktree.errGhNotAuthed", undefined, "`gh` not authenticated — run `gh auth login`");
    case "pr_exists":            return i18nT("worktree.errPrExists", undefined, "PR already exists for this branch");
    case "base_not_found":       return i18nT("worktree.errBaseNotFound", undefined, "base branch not found on origin");
    case "pushed_but_pr_failed": return i18nT("worktree.errPushedButPrFailed", undefined, "branch pushed, but `gh pr create` failed");
    default:                     return code;
  }
}

export interface WorktreeToast {
  level: "info" | "error" | "success";
  text: string;
  /** Captured stderr (gh / git output) for a collapsible details block. */
  stderr?: string;
}

/** Run Push and describe the outcome as a toast. */
export async function runWorktreePush(cwd: string): Promise<WorktreeToast> {
  const result = await pushWorktreeBranch({ cwd });
  if (result.ok) return { level: "success", text: i18nT("worktree.pushed", undefined, "Pushed.") };
  return { level: "error", text: i18nT("worktree.pushFailed", { reason: labelForCode(result.code) }, "push failed: {reason}"), stderr: result.stderr };
}

/** Open an http(s) URL in a new tab through an anchor click (`noopener,noreferrer`); `false` for any other scheme. */
function openHttpUrlInNewTab(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const a = document.createElement("a");
  a.href = parsed.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
  return true;
}

/** Run Open PR (opening the created PR in a tab) and describe the outcome as a toast; `null` = no toast. */
export async function runWorktreeOpenPr(cwd: string): Promise<WorktreeToast | null> {
  const result = await createWorktreePR({ cwd });
  const url = result.ok ? result.data?.url : undefined;
  // Only an http(s) URL is ever opened: the PR URL comes from `gh` output, so a
  // `javascript:` / `data:` value must never be navigated to.
  if (url && openHttpUrlInNewTab(url)) {
    return { level: "success", text: i18nT("worktree.prOpened", undefined, "PR opened.") };
  }
  if (!result.ok) {
    return { level: "error", text: i18nT("worktree.prFailed", { reason: labelForCode(result.code) }, "PR failed: {reason}"), stderr: result.stderr };
  }
  return null;
}
