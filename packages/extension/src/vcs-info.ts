/**
 * VCS info gathering — detects git branch/remote/PR and worktree state.
 * Delegates to shared platform tool modules so there's no inline execSync
 * and every call benefits from the runner's safety defaults (windowsHide,
 * timeout, tolerated exit codes).
 *
 * See change: platform-command-executor.
 */
import path from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import type { GitStatus, GitWorktreeInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildGitLinks, type GitLinks } from "./git-link-builder.js";

export interface GitInfo {
  gitBranch: string;
  gitBranchUrl?: string;
  gitPrNumber?: number;
  gitPrUrl?: string;
  /**
   * Worktree identity (mainPath, name) when cwd is a git worktree.
   * Undefined for the main checkout and for any cwd where the rev-parse
   * pair fails. Never carries `base` — that field is post-create
   * metadata supplied by the server.
   */
  gitWorktree?: GitWorktreeInfo;
}

/**
 * Detect whether `cwd` is a git repository as a tri-state.
 *
 * Uses the `git.isGitRepo()` `Result` (NOT `isGitRepoOr`) to distinguish
 * *confirmed non-git* from *unknown*:
 *   - `ok` → the boolean value (`git rev-parse --is-inside-work-tree`);
 *   - `error kind:"exit" code:128` → `false` (git ran and definitively
 *     reported "not a repository");
 *   - any other failure (missing binary, timeout, signal, other exit code)
 *     → `undefined` (unknown).
 *
 * Returns `undefined` — never `false` — on an inconclusive probe so a real
 * git repo whose probe failed never loses its truthy signal (the client
 * gate hides the `+Worktree` button only on a confirmed `false`).
 * See change: gate-session-worktree-button-on-git.
 */
export function detectIsGitRepo(cwd: string): boolean | undefined {
  const res = git.isGitRepo({ cwd });
  if (res.ok) return res.value;
  if (res.error.kind === "exit" && res.error.code === 128) return false;
  return undefined;
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

/**
 * Detect whether `cwd` is a git worktree (not the main checkout).
 *
 * Delegates to the shared checkout-root resolver, whose worktree signal is
 * `--git-dir != --git-common-dir`. The superseded test — "is the common dir
 * outside `--show-toplevel`" — reported a SUBMODULE as a worktree and then
 * derived `mainPath` as the parent of the common dir, i.e. a
 * `…/.git/modules/<name>` path that does not exist.
 *
 * Returns `undefined` when:
 *   - a required rev-parse invocation fails (not a repo, git missing, timeout);
 *   - the cwd is not a linked worktree — which now covers a submodule, a
 *     `--separate-git-dir` checkout, and a bare repository alike;
 *   - no main checkout resolves (a worktree of a bare hub has none);
 *   - the resolved main checkout is implausible.
 *
 * That last check is this consumer's own obligation: the resolver returns a
 * user-controlled `core.worktree` value verbatim and does not judge it. Being
 * a DISPLAY consumer, the safe response here is to omit the field rather than
 * put a `.git`-internal path on the wire.
 *
 * See change: add-git-checkout-root-resolver.
 */
export function detectWorktree(cwd: string): GitWorktreeInfo | undefined {
  const roots = git.checkoutRoots({ cwd });
  if (!roots || !roots.isLinkedWorktree) return undefined;

  const mainPath = roots.mainCheckout;
  if (!mainPath || git.hasGitPathSegment(mainPath)) return undefined;

  // `thisCheckout`, not `cwd`: a session can sit in a SUBDIRECTORY of the
  // worktree, and `basename(cwd)` would then label the card with the subdir
  // name. The verdict already carries the worktree root.
  return { mainPath, name: path.basename(roots.thisCheckout ?? cwd) };
}

/**
 * Gather working-tree dirtiness + upstream drift for `cwd` via one
 * `git status --porcelain=v2 --branch` call. Returns `undefined` on an
 * inconclusive probe (git missing, not a repo, timeout) so the broadcast
 * omits the field rather than sending a false all-clean status.
 * See change: add-session-uncommitted-indicator-and-commit.
 */
export function gatherGitStatus(cwd: string): GitStatus | undefined {
  const res = git.gitStatusV2({ cwd });
  return res.ok ? res.value : undefined;
}

/** Gather all git info for a directory. Returns undefined if not a git repo. */
export function gatherGitInfo(cwd: string): GitInfo | undefined {
  const branch = detectBranch(cwd);
  if (!branch) return undefined;

  const remoteUrl = detectRemoteUrl(cwd);
  const prNumber = detectPrNumber(cwd);
  const gitWorktree = detectWorktree(cwd);

  const links: GitLinks = remoteUrl ? buildGitLinks(remoteUrl, branch, prNumber) : {};

  return {
    gitBranch: branch,
    gitBranchUrl: links.branchUrl,
    gitPrNumber: prNumber,
    gitPrUrl: links.prUrl,
    gitWorktree,
  };
}
