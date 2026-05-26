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
import { existsSync, realpathSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as git from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import * as jj from "@blackbelt-technology/pi-dashboard-shared/platform/jj.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { GitWorktreeInfo, JjState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
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
 * Uses the canonical signal: `git rev-parse --git-common-dir` resolves
 * to a path OUTSIDE `git rev-parse --show-toplevel` when the cwd is a
 * worktree (because `--git-common-dir` points back at the main repo's
 * `.git/`, while `--show-toplevel` is the worktree's own root).
 *
 * Returns `undefined` when:
 *   - either rev-parse invocation fails (not a repo, git missing,
 *     permission, etc.),
 *   - the cwd IS the main checkout (`commonDir` is inside `topLevel`).
 *
 * Resolution is path-prefix based with case-folding on Windows/macOS
 * via the shared platform helpers; relative `commonDir` outputs (which
 * happen on some git versions when cwd === main repo) are normalised
 * to absolute via `path.resolve(cwd, commonDir)`.
 */
export function detectWorktree(cwd: string): GitWorktreeInfo | undefined {
  const commonDirRaw = git.commonDirOr({ cwd });
  const topLevel = git.toplevelOr({ cwd });
  if (!commonDirRaw || !topLevel) return undefined;

  // Normalise commonDir: when it's relative (`.git`), resolve against cwd.
  // When absolute, leave as-is.
  const commonDirAbs = path.isAbsolute(commonDirRaw)
    ? commonDirRaw
    : path.resolve(cwd, commonDirRaw);

  // Main checkout: commonDir == <toplevel>/.git (or anywhere inside toplevel).
  // Worktree:      commonDir == <main-repo>/.git, which is NOT inside the
  //                worktree's toplevel.
  const topWithSep = topLevel.endsWith(path.sep) ? topLevel : topLevel + path.sep;
  const insideToplevel =
    commonDirAbs === topLevel || commonDirAbs.startsWith(topWithSep);
  if (insideToplevel) return undefined;

  // `commonDir` for a worktree is `<main-repo>/.git` — the parent dir is
  // the main worktree root.
  const mainPath = path.dirname(commonDirAbs);
  const name = path.basename(cwd);
  return { mainPath, name };
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

  // Decision 1 (change: fix-jj-workspace-root-probe): derive the **parent
  // repo root** by reading `<cwd>/.jj/repo` from the filesystem.
  //
  // - Directory entry → cwd is the original (default) workspace; the
  //   parent repo root equals cwd.
  // - File entry → contents are a relative path to the shared storage
  //   `.jj/repo` directory; resolve and take its parent.
  //
  // Neither `jj workspace root` nor its alias `jj root` is suitable as
  // the primary derivation — both return the CURRENT workspace's own cwd,
  // which equals `cwd` for non-default workspaces and would silently
  // defeat workspace-aware session grouping (see Decision 15 of
  // add-jj-workspace-plugin; verified against jj 0.40).
  //
  // Fallback: on filesystem read error we fall back to `jj workspace root`
  // so `workspaceRoot` is still populated (which the badge / workspace UI
  // gates on) and record the failure in `lastError`.
  try {
    workspaceRoot = deriveJjRepoRoot(cwd);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    const fallbackResult = jj.workspaceRoot({ cwd });
    if (fallbackResult.ok) {
      workspaceRoot = fallbackResult.value;
    } else if (fallbackResult.error.kind !== "not-found") {
      // Keep the original .jj/repo error in lastError — it's the more
      // diagnostic of the two.
    }
  }

  // Decision 4 (change: fix-jj-workspace-root-probe): canonicalize via
  // realpath before emit. `pathKey` in the client does syntactic
  // normalization only (no symlink resolution), so the macOS
  // `/tmp` → `/private/tmp` symlink would silently break the group-key
  // collapse if we emitted the un-canonical form. Mirrors the hardening
  // git worktree applies to every cross-checkout path comparison.
  if (workspaceRoot) {
    workspaceRoot = canonicalizePathOrFallback(workspaceRoot);
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

/**
 * Derive the **parent repo root** from `<cwd>/.jj/repo`.
 *
 * jj's on-disk layout (stable since workspace support landed):
 * - In the **default** workspace, `<cwd>/.jj/repo/` is a directory
 *   containing the actual repository storage. The parent repo root
 *   equals `cwd`.
 * - In a `jj workspace add`-created **non-default** workspace,
 *   `<cwd>/.jj/repo` is a **file** whose contents are a relative path
 *   (e.g. `../../../.jj/repo`) pointing at the shared storage's
 *   `.jj/repo` directory. The parent of that resolved directory is the
 *   parent repo root.
 *
 * Structural analog of git's `.git`-as-file in linked worktrees. Pure
 * filesystem read — no subprocess.
 *
 * Throws on read errors so the caller can fall back to a subprocess.
 * Callers MUST have already checked that `<cwd>/.jj/` exists (the
 * probe's fast-path gate).
 *
 * See change: fix-jj-workspace-root-probe.
 */
export function deriveJjRepoRoot(cwd: string): string {
  const repoPath = path.join(cwd, ".jj", "repo");
  const stats = statSync(repoPath); // throws on missing
  if (stats.isDirectory()) {
    // Default workspace — cwd is the parent repo root.
    return cwd;
  }
  // Non-default workspace — .jj/repo is a file pointing at the storage.
  const raw = readFileSync(repoPath, "utf8").trim();
  if (!raw) {
    throw new Error(`.jj/repo is empty (expected relative path to storage)`);
  }
  // Contents are relative to <cwd>/.jj/ (the directory containing the file).
  const storageRepoDir = path.resolve(path.join(cwd, ".jj"), raw);
  // Storage `.jj/repo` directory → storage `.jj/` is its parent → storage
  // working-copy dir (the parent repo root) is the grandparent.
  return path.dirname(path.dirname(storageRepoDir));
}

/**
 * Best-effort `fs.realpathSync.native` to resolve symlinks (e.g. macOS
 * `/tmp` → `/private/tmp`). If the path no longer exists on disk (race
 * with workspace removal) or the syscall fails for any other reason,
 * fall back to the raw value rather than returning undefined — a
 * non-canonical path is still more useful than no path.
 *
 * `realpathSync.native` is preferred over `realpathSync` because it uses
 * the OS's native `realpath()` rather than the JS-shimmed implementation,
 * matching what other tools (git, jj) emit when they canonicalize.
 */
function canonicalizePathOrFallback(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
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
