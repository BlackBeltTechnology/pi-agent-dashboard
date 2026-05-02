/**
 * VCS info gathering — detects git branch/remote/PR AND jj workspace state.
 * Delegates to shared platform tool modules so there's no inline execSync
 * and every call benefits from the runner's safety defaults (windowsHide,
 * timeout, tolerated exit codes).
 *
 * jj probing is fast-path-gated: when `<cwd>/.jj/` doesn't exist, NO `jj`
 * subprocess is spawned. Only sessions inside a jj repo pay the probe cost.
 *
 * See changes: platform-command-executor, add-jj-workspace-plugin.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import * as jj from "@blackbelt-technology/pi-dashboard-shared/platform/jj.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { JjState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildGitLinks, type GitLinks } from "./git-link-builder.js";

export interface GitInfo {
  gitBranch: string;
  gitBranchUrl?: string;
  gitPrNumber?: number;
  gitPrUrl?: string;
}

/** Detect the current git branch. Returns short SHA for detached HEAD. */
export function detectBranch(cwd: string): string | undefined {
  const ref = git.currentBranchOr({ cwd });
  if (!ref) return undefined;
  if (ref === "HEAD") {
    // Detached HEAD — return short commit SHA
    return git.headShaOr({ cwd, short: true }) ?? "HEAD";
  }
  return ref;
}

/** Detect the remote origin URL. */
export function detectRemoteUrl(cwd: string): string | undefined {
  return git.remoteUrlOr({ cwd });
}

/** Detect the PR number via gh CLI (best effort). */
export function detectPrNumber(cwd: string): number | undefined {
  return git.prNumberOr({ cwd });
}

/** Gather all git info for a directory. Returns undefined if not a git repo. */
export function gatherGitInfo(cwd: string): GitInfo | undefined {
  const branch = detectBranch(cwd);
  if (!branch) return undefined;

  const remoteUrl = detectRemoteUrl(cwd);
  const prNumber = detectPrNumber(cwd);

  const links: GitLinks = remoteUrl ? buildGitLinks(remoteUrl, branch, prNumber) : {};

  return {
    gitBranch: branch,
    gitBranchUrl: links.branchUrl,
    gitPrNumber: prNumber,
    gitPrUrl: links.prUrl,
  };
}

// ── Jujutsu probing ────────────────────────────────────────────────────────

/**
 * Module-level cache: result of resolving `jj` once per process. The tool
 * registry already memoizes resolutions, but reading it on every probe tick
 * adds noise to traces. Single read on first probe, sticky for the process.
 */
let jjAvailable: boolean | undefined;

function isJjResolvable(): boolean {
  if (jjAvailable !== undefined) return jjAvailable;
  try {
    const reg = getDefaultRegistry();
    const res = reg.resolve("jj");
    jjAvailable = res.ok;
  } catch {
    jjAvailable = false;
  }
  return jjAvailable;
}

/**
 * Test-only hook to reset the jj-availability cache.
 * Production code MUST NOT call this.
 */
export function _resetJjAvailableForTests(): void {
  jjAvailable = undefined;
}

/**
 * Gather jj workspace state for a directory.
 * Returns `undefined` when:
 *   - `jj` is not resolvable via the tool registry, OR
 *   - `.jj/` does not exist in cwd (fast path, no subprocess spawn).
 *
 * Returns a populated `JjState` when both conditions are met. Errors during
 * `jj` invocation surface in `lastError` rather than throwing; the rest of
 * the fields fall back to undefined / empty.
 *
 * Per spec scenario "Non-jj cwd incurs no jj subprocess cost".
 */
export function gatherJjInfo(cwd: string): JjState | undefined {
  if (!isJjResolvable()) return undefined;
  if (!existsSync(path.join(cwd, ".jj"))) return undefined;

  const isColocated = existsSync(path.join(cwd, ".git"));

  // Resolve workspace name + root. Errors are caught and surfaced via
  // lastError so callers always get *some* JjState rather than nothing.
  let workspaceName: string | undefined;
  let workspaceRoot: string | undefined;
  let lastError: string | undefined;

  const rootResult = jj.workspaceRoot({ cwd });
  if (rootResult.ok) {
    workspaceRoot = rootResult.value;
  } else if (rootResult.error.kind !== "not-found") {
    lastError = describeJjError(rootResult.error);
  }

  // Workspace name: parse `jj workspace list` and match by working-copy
  // path. The CLI does not include the path in list output, so we fall
  // back to identifying the workspace via the `<name>@` revset matching
  // the workspace root. For now: if there's only one workspace, use
  // its name; otherwise default to "default" if found, else first entry.
  // (Multi-workspace name disambiguation tracked as Phase 4 follow-up.)
  const listResult = jj.workspaceList({ cwd });
  if (listResult.ok) {
    const entries = jj.parseWorkspaceList(listResult.value);
    if (entries.length === 1) {
      workspaceName = entries[0]?.name;
    } else if (entries.length > 1) {
      workspaceName = entries.find((e) => e.name === "default")?.name
        ?? entries[0]?.name;
    }
  } else if (listResult.error.kind !== "not-found" && !lastError) {
    lastError = describeJjError(listResult.error);
  }

  return {
    isJjRepo: true,
    isColocated,
    workspaceName,
    workspaceRoot,
    lastError,
  };
}

function describeJjError(
  error: { kind: string; [k: string]: unknown },
): string {
  if (error.kind === "timeout") return "jj probe timed out";
  if (error.kind === "exit") {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    return stderr.split("\n")[0] || `jj exited ${String(error.code)}`;
  }
  if (error.kind === "spawn-failure") {
    return typeof error.message === "string" ? error.message : "spawn failed";
  }
  return error.kind;
}

// ── Combined VCS gather ────────────────────────────────────────────────────

export interface VcsInfo {
  git?: GitInfo;
  jj?: JjState;
}

/**
 * Convenience helper that gathers both git and jj info in one call.
 * Used by the bridge's per-session 30 s probe tick.
 */
export function gatherVcsInfo(cwd: string): VcsInfo {
  return {
    git: gatherGitInfo(cwd),
    jj: gatherJjInfo(cwd),
  };
}
