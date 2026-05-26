/**
 * Client-side git API helpers for the BranchPicker / BranchSwitchDialog.
 */
import type { GitBranchesResult, GitStashPopResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";

export async function fetchBranches(cwd: string): Promise<GitBranchesResult> {
  const res = await fetch(`${getApiBase()}/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to list branches");
  return json.data;
}

export interface CheckoutOk {
  success: true;
  stashed?: boolean;
}

export interface CheckoutDirty {
  success: false;
  dirty: true;
  files: string[];
}

export type CheckoutResult = CheckoutOk | CheckoutDirty;

export async function checkoutBranch(
  cwd: string,
  branch: string,
  stash: boolean = false
): Promise<CheckoutResult> {
  const res = await fetch(`${getApiBase()}/api/git/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, branch, stash }),
  });
  const json = await res.json();
  if (res.status === 409 && json.dirty) {
    return { success: false, dirty: true, files: json.files };
  }
  if (!json.success) throw new Error(json.error ?? "checkout failed");
  return { success: true, stashed: json.data?.stashed };
}

export async function gitInit(cwd: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/git/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "init failed");
}

export async function stashPop(cwd: string): Promise<GitStashPopResult> {
  const res = await fetch(`${getApiBase()}/api/git/stash-pop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "stash pop failed");
  return json.data;
}

// ── Worktree endpoints ────────────────────────────────────────────────────────────────────────────────
// See change: add-worktree-spawn-dialog.

export interface HeadInfo {
  branch: string | null;
  detached: boolean;
  sha: string | null;
  /** Server-cheap stat probe: true iff `.gitmodules` exists at the repo's
   * top level. The worktree dialog uses this to gate a footnote.
   * See change: add-worktree-spawn-dialog. */
  hasSubmodules?: boolean;
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  sha: string;
  bare: boolean;
  detached: boolean;
  isMain: boolean;
}

export interface CreateWorktreeOk {
  ok: true;
  path: string;
  branch: string;
  excludeAppended: boolean;
}

export interface CreateWorktreeError {
  ok: false;
  code: string;
  error: string;
  stderr?: string;
}

export type CreateWorktreeResult = CreateWorktreeOk | CreateWorktreeError;

/** GET /api/git/head */
export async function fetchGitHead(cwd: string): Promise<HeadInfo> {
  const res = await fetch(`${getApiBase()}/api/git/head?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to read HEAD");
  return json.data as HeadInfo;
}

/** GET /api/git/worktrees */
export async function fetchWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const res = await fetch(`${getApiBase()}/api/git/worktrees?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to list worktrees");
  return (json.data?.worktrees ?? []) as WorktreeEntry[];
}

/** POST /api/git/worktree. Returns a discriminated union so the caller can
 * branch on a stable error `code` without parsing strings. */
export async function createWorktree(params: {
  cwd: string;
  base: string;
  newBranch: string;
  path?: string;
  force?: boolean;
}): Promise<CreateWorktreeResult> {
  const res = await fetch(`${getApiBase()}/api/git/worktree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.success) {
    return { ok: true, ...(json.data as { path: string; branch: string; excludeAppended: boolean }) };
  }
  return {
    ok: false,
    code: json.code ?? "git_failed",
    error: json.error ?? "worktree create failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
  };
}

// ── Worktree lifecycle endpoints ─────────────────────────────────────────
// See change: add-worktree-lifecycle-actions.

export interface LifecycleSuccess<T = unknown> { ok: true; data?: T; }
export interface LifecycleFailure { ok: false; code: string; error: string; stderr?: string; data?: { sessionIds?: string[] }; }
export type LifecycleResult<T = unknown> = LifecycleSuccess<T> | LifecycleFailure;

async function postLifecycle<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<LifecycleResult<T>> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.success) return { ok: true, data: json.data as T };
  return {
    ok: false,
    code: json.code ?? "git_failed",
    error: json.error ?? "operation failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
    ...(json.data ? { data: json.data } : {}),
  };
}

/** POST /api/git/worktree/remove */
export async function removeWorktree(params: { cwd: string; force?: boolean }): Promise<LifecycleResult<{ removed: true }>> {
  return postLifecycle("/api/git/worktree/remove", params);
}

/** POST /api/git/worktree/merge */
export async function mergeWorktree(params: { cwd: string; deleteBranch?: boolean }): Promise<LifecycleResult<{ mergeSha: string; branchDeleted: boolean }>> {
  return postLifecycle("/api/git/worktree/merge", params);
}

/** POST /api/git/worktree/push */
export async function pushWorktreeBranch(params: { cwd: string; setUpstream?: boolean }): Promise<LifecycleResult<undefined>> {
  return postLifecycle("/api/git/worktree/push", params);
}

/** POST /api/git/worktree/pr */
export async function createWorktreePR(params: { cwd: string; title?: string; body?: string }): Promise<LifecycleResult<{ url: string; pushed: boolean }>> {
  return postLifecycle("/api/git/worktree/pr", params);
}

/** GET /api/git/worktree/diff-stat */
export async function fetchWorktreeDiffStat(cwd: string): Promise<LifecycleResult<{ summary: string; filesChanged: number; insertions: number; deletions: number; base: string; branch: string }>> {
  const res = await fetch(`${getApiBase()}/api/git/worktree/diff-stat?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json();
  if (json.success) return { ok: true, data: json.data };
  return {
    ok: false,
    code: json.code ?? "git_failed",
    error: json.error ?? "diff-stat failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
  };
}
