/**
 * Git tool module — Recipe-based API for git operations the dashboard runs
 * from multiple call sites (session-diff, git-info extension, doctor).
 *
 * Every function in this file is a thin wrapper over `run(recipe, input)`:
 * no `child_process` imports, no `process.platform` branches, no inline
 * shell-escape logic. The Recipe objects describe *what* git invocation
 * to run; the runner handles *how* to spawn it safely.
 *
 * Exit codes:
 *   `git diff`   exits 0 when there's a diff, 1 when there's nothing to
 *                show (we tolerate 1).
 *   Other commands exit 0 on success and non-zero on real errors.
 *
 * See change: platform-command-executor.
 */
import type { GitStatus } from "../types.js";
import { type Recipe, type Result, run, runAsync, unwrap } from "./runner.js";

/**
 * Parse `git status --porcelain=v2 --branch` stdout into a `GitStatus`.
 *
 * Porcelain v2 line kinds:
 *   `# branch.ab +A -B`  — ahead/behind header (absent when no upstream)
 *   `1 <XY> ...`         — ordinary changed file (X=staged, Y=unstaged; `.`=clean)
 *   `2 <XY> ...`         — renamed/copied file (same XY semantics)
 *   `u <XY> ...`         — unmerged (conflict) file
 *   `? <path>`           — untracked file
 *   `! <path>`           — ignored file (not counted)
 *
 * `dirtyCount` = distinct changed files = (1|2|u lines) + (? lines). A file
 * that is both staged and unstaged is one line → counted once toward
 * `dirtyCount`, but toward both `staged` and `unstaged`. Pure/total — an
 * empty or clean status yields all-zero counts.
 *
 * See change: add-session-uncommitted-indicator-and-commit.
 */
export function parseGitStatusV2(stdout: string): GitStatus {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let tracked = 0; // 1|2|u lines
  let ahead = 0;
  let behind = 0;

  for (const line of stdout.split("\n")) {
    if (line.length === 0) continue;
    const kind = line[0];
    if (kind === "#") {
      // `# branch.ab +A -B`
      if (line.startsWith("# branch.ab ")) {
        const m = /\+(-?\d+) -(-?\d+)/.exec(line);
        if (m) {
          ahead = Math.abs(parseInt(m[1], 10)) || 0;
          behind = Math.abs(parseInt(m[2], 10)) || 0;
        }
      }
      continue;
    }
    if (kind === "?") {
      untracked++;
      continue;
    }
    if (kind === "!") continue; // ignored
    if (kind === "1" || kind === "2" || kind === "u") {
      tracked++;
      // Field 2 is the two-char XY status (e.g. "1 .M ..." or "1 M. ...").
      const xy = line.split(" ", 2)[1] ?? "..";
      const x = xy[0];
      const y = xy[1];
      if (x && x !== ".") staged++;
      if (y && y !== ".") unstaged++;
    }
  }

  return {
    dirtyCount: tracked + untracked,
    staged,
    unstaged,
    untracked,
    ahead,
    behind,
  };
}

// ── Recipes (pure data) ─────────────────────────────────────────────────────

const GIT_TIMEOUT = 15_000;

interface WithCwd {
  cwd: string;
}

export const GIT_IS_REPO: Recipe<WithCwd, boolean> = {
  argv: () => ["git", "rev-parse", "--is-inside-work-tree"],
  parse: (out) => out.trim() === "true",
  timeout: GIT_TIMEOUT,
};

export const GIT_CURRENT_BRANCH: Recipe<WithCwd, string | undefined> = {
  argv: () => ["git", "rev-parse", "--abbrev-ref", "HEAD"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

export const GIT_HEAD_SHA: Recipe<WithCwd & { short?: boolean }, string | undefined> = {
  argv: ({ short }) => short ? ["git", "rev-parse", "--short", "HEAD"] : ["git", "rev-parse", "HEAD"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

export const GIT_REMOTE_URL: Recipe<WithCwd & { remote?: string }, string | undefined> = {
  argv: ({ remote }) => ["git", "remote", "get-url", remote ?? "origin"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

export const GIT_COMMON_DIR: Recipe<WithCwd, string | undefined> = {
  argv: () => ["git", "rev-parse", "--git-common-dir"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

export const GIT_TOPLEVEL: Recipe<WithCwd, string | undefined> = {
  argv: () => ["git", "rev-parse", "--show-toplevel"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

export const GIT_DIFF: Recipe<WithCwd & { path: string; ref?: string }, string> = {
  argv: ({ path, ref }) => ["git", "diff", ref ?? "HEAD", "--", path],
  parse: (out) => out,
  timeout: GIT_TIMEOUT,
  // git diff exits 1 when --exit-code is set or in some configurations;
  // no diff is not an error for our callers.
  tolerate: [1],
};

export const GIT_NUMSTAT: Recipe<WithCwd & { ref?: string }, string> = {
  // `--relative` outputs pathnames relative to cwd (matching the cwd-relative
  // FileDiffEntry keys) and excludes changes outside cwd. Tab-separated:
  // `<adds>\t<dels>\t<path>`; binary files report `-` for the counts.
  argv: ({ ref }) => ["git", "diff", "--numstat", "--relative", ref ?? "HEAD"],
  parse: (out) => out,
  timeout: GIT_TIMEOUT,
  tolerate: [1],
};

/**
 * Batched whole-worktree content diff: one `git diff --relative HEAD` over
 * every changed file (no per-path arg). `--relative` yields cwd-relative
 * header paths matching the cwd-relative FileDiffEntry keys (same as
 * `GIT_NUMSTAT`). Callers split the patch per file on `diff --git ` header
 * boundaries. Run via `runAsync` (non-blocking) — this is the batched
 * replacement for the O(files) per-file `GIT_DIFF` spawn loop. See change:
 * fix-session-diff-eventloop-block.
 */
export const GIT_DIFF_ALL: Recipe<WithCwd & { ref?: string }, string> = {
  argv: ({ ref }) => ["git", "diff", "--relative", ref ?? "HEAD"],
  parse: (out) => out,
  timeout: GIT_TIMEOUT,
  tolerate: [1],
};

export const GIT_STATUS_PORCELAIN: Recipe<WithCwd & { path?: string }, string> = {
  argv: ({ path }) =>
    path === undefined
      ? ["git", "status", "--porcelain"]
      : ["git", "status", "--porcelain", "--", path],
  parse: (out) => out,
  timeout: GIT_TIMEOUT,
};

/** `git status --porcelain=v2 --branch` → parsed dirty/drift counts. */
export const GIT_STATUS_V2: Recipe<WithCwd, GitStatus> = {
  argv: () => ["git", "status", "--porcelain=v2", "--branch"],
  parse: (out) => parseGitStatusV2(out),
  timeout: GIT_TIMEOUT,
};

/**
 * `gh pr view --json number -q .number` — requires the `gh` CLI.
 * Returns undefined when there is no PR for the current branch (gh exits 1).
 */
export const GH_PR_NUMBER: Recipe<WithCwd, number | undefined> = {
  argv: () => ["gh", "pr", "view", "--json", "number", "-q", ".number"],
  parse: (out) => {
    const n = parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  },
  timeout: GIT_TIMEOUT,
  tolerate: [1], // gh exits 1 when no PR exists — not an error
};

// ── Registry (for lint / docs / enumeration) ────────────────────────────────

export const GIT_RECIPES = {
  GIT_IS_REPO,
  GIT_CURRENT_BRANCH,
  GIT_HEAD_SHA,
  GIT_REMOTE_URL,
  GIT_COMMON_DIR,
  GIT_TOPLEVEL,
  GIT_DIFF,
  GIT_DIFF_ALL,
  GIT_NUMSTAT,
  GIT_STATUS_PORCELAIN,
  GIT_STATUS_V2,
  GH_PR_NUMBER,
} as const;

// ── Public API — typed functions (use Result for explicit control) ──────────

export function isGitRepo(input: WithCwd): Result<boolean> {
  return run(GIT_IS_REPO, input, { cwd: input.cwd });
}

export function currentBranch(input: WithCwd): Result<string | undefined> {
  return run(GIT_CURRENT_BRANCH, input, { cwd: input.cwd });
}

export function headSha(input: WithCwd & { short?: boolean }): Result<string | undefined> {
  return run(GIT_HEAD_SHA, input, { cwd: input.cwd });
}

export function remoteUrl(input: WithCwd & { remote?: string }): Result<string | undefined> {
  return run(GIT_REMOTE_URL, input, { cwd: input.cwd });
}

export function commonDir(input: WithCwd): Result<string | undefined> {
  return run(GIT_COMMON_DIR, input, { cwd: input.cwd });
}

export function toplevel(input: WithCwd): Result<string | undefined> {
  return run(GIT_TOPLEVEL, input, { cwd: input.cwd });
}

export function diff(input: WithCwd & { path: string; ref?: string }): Result<string> {
  return run(GIT_DIFF, input, { cwd: input.cwd });
}

export function statusPorcelain(input: WithCwd & { path?: string }): Result<string> {
  return run(GIT_STATUS_PORCELAIN, input, { cwd: input.cwd });
}

/** Parsed working-tree dirtiness + upstream drift. */
export function gitStatusV2(input: WithCwd): Result<GitStatus> {
  return run(GIT_STATUS_V2, input, { cwd: input.cwd });
}

export function numstat(input: WithCwd & { ref?: string }): Result<string> {
  return run(GIT_NUMSTAT, input, { cwd: input.cwd });
}

export function prNumber(input: WithCwd): Result<number | undefined> {
  return run(GH_PR_NUMBER, input, { cwd: input.cwd });
}

// ── Best-effort convenience wrappers (swallow errors → default) ─────────────
// Callers that only want "the value or a default" without dealing with Result
// discriminants can use these instead.

export function isGitRepoOr(input: WithCwd, fallback = false): boolean {
  return unwrap(isGitRepo(input), fallback);
}

export function currentBranchOr(input: WithCwd, fallback?: string): string | undefined {
  return unwrap(currentBranch(input), fallback);
}

export function headShaOr(input: WithCwd & { short?: boolean }, fallback?: string): string | undefined {
  return unwrap(headSha(input), fallback);
}

export function remoteUrlOr(input: WithCwd & { remote?: string }, fallback?: string): string | undefined {
  return unwrap(remoteUrl(input), fallback);
}

export function commonDirOr(input: WithCwd, fallback?: string): string | undefined {
  return unwrap(commonDir(input), fallback);
}

export function toplevelOr(input: WithCwd, fallback?: string): string | undefined {
  return unwrap(toplevel(input), fallback);
}

export function diffOr(input: WithCwd & { path: string; ref?: string }, fallback = ""): string {
  return unwrap(diff(input), fallback);
}

export function statusPorcelainOr(input: WithCwd & { path?: string }, fallback = ""): string {
  return unwrap(statusPorcelain(input), fallback);
}

export function numstatOr(input: WithCwd & { ref?: string }, fallback = ""): string {
  return unwrap(numstat(input), fallback);
}

export function prNumberOr(input: WithCwd, fallback?: number): number | undefined {
  return unwrap(prNumber(input), fallback);
}

// ── Async (non-blocking) API — for hot request paths ────────────────────────
// These spawn via `runAsync` so no `spawnSync` blocks the event loop. Use them
// on server request paths (e.g. `/api/session-diff`) that must stay responsive
// while git reads large blobs. See change: fix-session-diff-eventloop-block.

/** Batched whole-worktree `git diff --relative HEAD` (async, one spawn). */
export function diffAll(input: WithCwd & { ref?: string }): Promise<Result<string>> {
  return runAsync(GIT_DIFF_ALL, input, { cwd: input.cwd });
}

/** Best-effort async batched diff — the raw patch or `fallback` on any error. */
export async function diffAllOr(input: WithCwd & { ref?: string }, fallback = ""): Promise<string> {
  return unwrap(await diffAll(input), fallback);
}

/** Async `git rev-parse --is-inside-work-tree` → boolean (fallback on error). */
export async function isGitRepoOrAsync(input: WithCwd, fallback = false): Promise<boolean> {
  return unwrap(await runAsync(GIT_IS_REPO, input, { cwd: input.cwd }), fallback);
}

/** Async `git status --porcelain` → raw stdout (fallback on error). */
export async function statusPorcelainOrAsync(
  input: WithCwd & { path?: string },
  fallback = "",
): Promise<string> {
  return unwrap(await runAsync(GIT_STATUS_PORCELAIN, input, { cwd: input.cwd }), fallback);
}

/** Async `git diff --numstat --relative HEAD` → raw stdout (fallback on error). */
export async function numstatOrAsync(input: WithCwd & { ref?: string }, fallback = ""): Promise<string> {
  return unwrap(await runAsync(GIT_NUMSTAT, input, { cwd: input.cwd }), fallback);
}

/** Async `git rev-parse HEAD` → sha (fallback on error). */
export async function headShaOrAsync(
  input: WithCwd & { short?: boolean },
  fallback?: string,
): Promise<string | undefined> {
  return unwrap(await runAsync(GIT_HEAD_SHA, input, { cwd: input.cwd }), fallback);
}
