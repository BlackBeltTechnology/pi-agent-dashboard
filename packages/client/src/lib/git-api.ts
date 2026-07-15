/**
 * Client-side git API helpers for the BranchPicker / BranchSwitchDialog.
 */
import type { ActiveWorktreeInit, WorktreeInitTrustScope } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { GitBranchesResult, GitChangedFile, GitCommitResult, GitStashPopResult, PullRequestInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "./api-context.js";
import { fetchJson, fetchJsonResponse } from "./fetch-json.js";
import { resolveServerMessage } from "./server-error.js";

// ── Uncommitted-indicator + commit (session-uncommitted-indicator-and-commit) ─

/** GET /api/git/status — fresh working-tree dirtiness + drift. Null on failure. */
export async function fetchGitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/git/status?cwd=${encodeURIComponent(cwd)}`);
    return json.success ? (json.data as GitStatus) : null;
  } catch {
    return null;
  }
}

/** GET /api/git/changed-files — file list for the commit dialog picker. */
export async function fetchChangedFiles(cwd: string): Promise<GitChangedFile[]> {
  const json = await fetchJson(`${getApiBase()}/api/git/changed-files?cwd=${encodeURIComponent(cwd)}`);
  if (!json.success) throw new Error(json.error ?? "failed to list changed files");
  return json.data as GitChangedFile[];
}

export type CommitResult =
  | { ok: true; data: GitCommitResult }
  | { ok: false; code: string; error: string };

/** POST /api/git/commit — stage + commit the selected files. */
export async function commitFiles(params: {
  cwd: string;
  message: string;
  files: string[];
}): Promise<CommitResult> {
  try {
    const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (json.success) return { ok: true, data: json.data as GitCommitResult };
    return { ok: false, code: json.code ?? "commit-failed", error: json.error ?? "commit failed" };
  } catch (err: any) {
    return { ok: false, code: "network_failure", error: err?.message ?? "network failure" };
  }
}

/** POST /api/git/commit-draft — AI-drafted message. Empty string → manual entry. */
export async function draftCommitMessage(params: {
  cwd: string;
  files: string[];
  sessionId: string;
}): Promise<{ message: string; source: string }> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/git/commit-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (json.success) return json.data as { message: string; source: string };
    return { message: "", source: "stub" };
  } catch {
    return { message: "", source: "stub" };
  }
}

export async function fetchBranches(cwd: string): Promise<GitBranchesResult> {
  const json = await fetchJson(`${getApiBase()}/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
  if (!json.success)
    throw new Error(resolveServerMessage({ code: json.code, message: json.error ?? "failed to list branches" }));
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
  const { res, json } = await fetchJsonResponse(`${getApiBase()}/api/git/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, branch, stash }),
  });
  if (res.status === 409 && json.dirty) {
    return { success: false, dirty: true, files: json.files };
  }
  if (!json.success)
    throw new Error(resolveServerMessage({ code: json.code, message: json.error ?? "checkout failed" }));
  return { success: true, stashed: json.data?.stashed };
}

export async function gitInit(cwd: string): Promise<void> {
  const json = await fetchJson(`${getApiBase()}/api/git/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  if (!json.success)
    throw new Error(resolveServerMessage({ code: json.code, message: json.error ?? "init failed" }));
}

export async function stashPop(cwd: string): Promise<GitStashPopResult> {
  const json = await fetchJson(`${getApiBase()}/api/git/stash-pop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  if (!json.success)
    throw new Error(resolveServerMessage({ code: json.code, message: json.error ?? "stash pop failed" }));
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
  /**
   * Present when `code === "path_exists"`. `true` when the colliding
   * path is NOT a registered worktree (likely orphan), `false` when it
   * IS a registered worktree. Drives the dialog's inline `[Clean up]`
   * button.
   * See change: openspec-worktree-spawn-button.
   */
  orphanLikely?: boolean;
}

export type CreateWorktreeResult = CreateWorktreeOk | CreateWorktreeError;


/** GET /api/git/head */
export async function fetchGitHead(cwd: string): Promise<HeadInfo> {
  const json = await fetchJson(`${getApiBase()}/api/git/head?cwd=${encodeURIComponent(cwd)}`);
  if (!json.success) throw new Error(json.error ?? "failed to read HEAD");
  return json.data as HeadInfo;
}

/** GET /api/git/worktrees */
export async function fetchWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const json = await fetchJson(`${getApiBase()}/api/git/worktrees?cwd=${encodeURIComponent(cwd)}`);
  if (!json.success) throw new Error(json.error ?? "failed to list worktrees");
  return (json.data?.worktrees ?? []) as WorktreeEntry[];
}

/** POST /api/git/worktree. Returns a discriminated union so the caller can
 * branch on a stable error `code` without parsing strings.
 *
 * Worktree creation no longer runs any init step; initialization is a
 * separate gated action (POST /api/git/worktree/init). See change:
 * generalize-worktree-init-hook.
 */
export async function createWorktree(params: {
  cwd: string;
  base: string;
  /**
   * Fork mode: new branch name to create. Omit for checkout mode — the
   * server checks out the existing `base` ref without `-b`.
   * See change: worktree-checkout-existing-branch.
   */
  newBranch?: string;
  path?: string;
  force?: boolean;
}): Promise<CreateWorktreeResult> {
  const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/worktree`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (json.success) {
    return { ok: true, ...(json.data as { path: string; branch: string; excludeAppended: boolean }) };
  }
  return {
    ok: false,
    code: json.code ?? "git_failed",
    error: json.error ?? "worktree create failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
    ...(typeof json.orphanLikely === "boolean" ? { orphanLikely: json.orphanLikely } : {}),
  };
}

/** Hook definition mirrored from the server (`worktree-init.ts`). */
export interface WorktreeInitHook {
  gate: string;
  run:
    | { type: "script"; command: string }
    | { type: "agent"; prompt: string; model?: string; settings?: unknown };
}

/** GET /api/git/worktree/init-status result. */
export interface WorktreeInitStatus {
  hasHook: boolean;
  /** Present only when hasHook === true. */
  needsInit?: boolean;
  /** Present only when hasHook === true. */
  trusted?: boolean;
  /**
   * Present only when hasHook === false. Distinguishes an unconfigured
   * directory (`false`, state ① → offer scaffold) from a configured project
   * with no worktreeInit hook (`true`, state ③ → no button). Absent on the
   * fail-open path. See change: distinguish-initialize-actions.
   */
  configured?: boolean;
}

/** GET /api/git/worktree/init-status?cwd=<path>. Fail-open: returns hasHook:false on error. */
export async function fetchWorktreeInitStatus(cwd: string): Promise<WorktreeInitStatus> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/git/worktree/init-status?cwd=${encodeURIComponent(cwd)}`);
    if (!json.success) return { hasHook: false };
    return json.data as WorktreeInitStatus;
  } catch {
    return { hasHook: false };
  }
}

/**
 * GET /api/preferences/worktree-auto-init. Fail-safe: returns `false` on any
 * error so a probe failure never silently auto-runs a hook.
 * See change: auto-init-worktree-on-spawn.
 */
export async function fetchAutoInitWorktreePref(): Promise<boolean> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/preferences/worktree-auto-init`);
    return json?.autoInitWorktreeOnSpawn === true;
  } catch {
    return false;
  }
}

/** PATCH /api/preferences/worktree-auto-init. Returns the persisted value. */
export async function setAutoInitWorktreePref(value: boolean): Promise<boolean> {
  const json = await fetchJson(`${getApiBase()}/api/preferences/worktree-auto-init`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  return json?.autoInitWorktreeOnSpawn === true;
}

/**
 * GET /api/preferences/auto-name. Fail-safe: returns `true` (the default-ON
 * behaviour) on any error. See change: add-auto-session-naming.
 */
export async function fetchAutoNameSessionsPref(): Promise<boolean> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/preferences/auto-name`);
    return json?.autoNameSessions !== false;
  } catch {
    return true;
  }
}

/** PATCH /api/preferences/auto-name. Returns the persisted value. */
export async function setAutoNameSessionsPref(value: boolean): Promise<boolean> {
  const json = await fetchJson(`${getApiBase()}/api/preferences/auto-name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  return json?.autoNameSessions !== false;
}

export interface WorktreeInitRanOk {
  ok: true;
  ran: boolean;
  durationMs?: number;
  skippedReason?: string;
}

/** Untrusted: server returned the hook def + hash awaiting confirmation. */
export interface WorktreeInitUntrusted {
  ok: false;
  untrusted: true;
  hook: WorktreeInitHook;
  hash: string;
}

export interface WorktreeInitError {
  ok: false;
  untrusted?: false;
  code: string;
  error: string;
  stderr?: string;
}

export type WorktreeInitResult = WorktreeInitRanOk | WorktreeInitUntrusted | WorktreeInitError;

/**
 * POST /api/git/worktree/init — runs the declared hook for a checkout.
 * Without `confirmHash` an untrusted hook returns `untrusted` carrying the
 * def + hash for the client to confirm; re-issue with `confirmHash: hash`.
 * On confirm, `scope` picks the trust durability (`session` = until dashboard
 * restart; `project` = persisted). Omitted → project (server default).
 * Progress events stream via the requestId-tagged WS channel.
 * See change: generalize-worktree-init-hook, add-session-scoped-init-trust.
 */
export async function runWorktreeInit(params: { cwd: string; requestId?: string; confirmHash?: string; scope?: WorktreeInitTrustScope }): Promise<WorktreeInitResult> {
  const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/worktree/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (json.success) {
    return { ok: true, ran: json.data?.ran === true, durationMs: json.data?.durationMs, skippedReason: json.data?.skippedReason };
  }
  if (json.code === "init_untrusted") {
    return { ok: false, untrusted: true, hook: json.data.hook as WorktreeInitHook, hash: json.data.hash as string };
  }
  return {
    ok: false,
    code: json.code ?? "init_failed",
    error: json.error ?? "init failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
  };
}

/**
 * GET /api/git/worktree/active-inits — boot rehydration of in-flight and
 * recently-finished init runs (server cwd-keyed registry). Fail-open: returns
 * `[]` on any error so a probe failure never blocks boot.
 * See change: friendlier-worktree-init.
 */
export async function fetchActiveInits(): Promise<ActiveWorktreeInit[]> {
  try {
    const json = await fetchJson(`${getApiBase()}/api/git/worktree/active-inits`);
    if (!json.success || !Array.isArray(json.data?.runs)) return [];
    return json.data.runs as ActiveWorktreeInit[];
  } catch {
    return [];
  }
}

export interface OrphanCleanupOk {
  ok: true;
}

export interface OrphanCleanupError {
  ok: false;
  code: string;
  error: string;
}

export type OrphanCleanupResult = OrphanCleanupOk | OrphanCleanupError;

/**
 * GET /api/file/exists — lightweight path-existence probe (gated to
 * cwd known to the session manager / pinned dirs). Returns `true` when
 * the path exists, `false` on 404, `false` on any error (defensive).
 *
 * Used by WorktreeSpawnDialog to detect orphan-path collisions before
 * submit. See change: openspec-worktree-spawn-button.
 */
export async function probePathExists(params: {
  cwd: string;
  path: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  try {
    const json = await fetchJson(
      `${getApiBase()}/api/file/exists?cwd=${encodeURIComponent(params.cwd)}&path=${encodeURIComponent(params.path)}`,
      { signal: params.signal },
    );
    return json?.data?.exists === true;
  } catch {
    return false;
  }
}

/**
 * POST /api/git/worktree/orphan-cleanup. Deletes a non-registered orphan
 * directory at `path` (must be inside `cwd`, must not contain `.git`,
 * bounded by file count + size).
 *
 * See change: openspec-worktree-spawn-button.
 */
export async function cleanupOrphanWorktreePath(params: {
  cwd: string;
  path: string;
}): Promise<OrphanCleanupResult> {
  const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/worktree/orphan-cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (json.success) {
    return { ok: true };
  }
  return {
    ok: false,
    code: json.code ?? "fs_failed",
    error: json.error ?? "orphan cleanup failed",
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
  const { json } = await fetchJsonResponse(`${getApiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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

// ── Pull request helpers (change: add-worktree-from-pull-request) ──────

export type FetchPrResult =
  | { ok: true; data: PullRequestInfo[] }
  | { ok: false; code: string; error: string };

/** GET /api/git/pull-requests */
export async function fetchPullRequests(cwd: string): Promise<FetchPrResult> {
  try {
    const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/pull-requests?cwd=${encodeURIComponent(cwd)}`);
    if (json.success) return { ok: true, data: json.data as PullRequestInfo[] };
    return { ok: false, code: json.code ?? "git_failed", error: json.error ?? "failed to list PRs" };
  } catch (err: any) {
    return { ok: false, code: "network_failure", error: err?.message ?? "network failure" };
  }
}

export type CreateWorktreeFromPrResult =
  | { ok: true; path: string; branch: string; prNumber: number }
  | CreateWorktreeError;

/** POST /api/git/worktree/from-pr */
export async function createWorktreeFromPr(params: {
  cwd: string;
  prNumber: number;
  path?: string;
}): Promise<CreateWorktreeFromPrResult> {
  try {
    const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/worktree/from-pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (json.success) {
      return { ok: true, ...(json.data as { path: string; branch: string; prNumber: number }) };
    }
    return {
      ok: false,
      code: json.code ?? "git_failed",
      error: json.error ?? "worktree from PR failed",
      ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
      ...(typeof json.orphanLikely === "boolean" ? { orphanLikely: json.orphanLikely } : {}),
    };
  } catch (err: any) {
    return {
      ok: false,
      code: "network_failure",
      error: err?.message ?? "network failure",
    };
  }
}

/** GET /api/git/worktree/diff-stat */
export async function fetchWorktreeDiffStat(cwd: string): Promise<LifecycleResult<{ summary: string; filesChanged: number; insertions: number; deletions: number; base: string; branch: string }>> {
  const { json } = await fetchJsonResponse(`${getApiBase()}/api/git/worktree/diff-stat?cwd=${encodeURIComponent(cwd)}`);
  if (json.success) return { ok: true, data: json.data };
  return {
    ok: false,
    code: json.code ?? "git_failed",
    error: json.error ?? "diff-stat failed",
    ...(typeof json.stderr === "string" ? { stderr: json.stderr } : {}),
  };
}
