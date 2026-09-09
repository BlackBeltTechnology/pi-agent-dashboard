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
import path from "node:path";
import type { GitStatus } from "../types.js";
import { normalizePath, samePath } from "./paths.js";
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

/**
 * `git rev-parse --path-format=absolute --git-dir` — the PER-WORKTREE git dir.
 *
 * `--path-format=absolute` is part of the contract, not a preference: without
 * it git reports the relative `.git` at a checkout root and an absolute path
 * from a subdirectory, and `isLinkedWorktree` is an equality test between this
 * probe and `GIT_COMMON_DIR_ABS`. Mixed forms would make every normal checkout
 * report as a linked worktree. See change: add-git-checkout-root-resolver.
 */
export const GIT_DIR_ABS: Recipe<WithCwd, string | undefined> = {
  argv: () => ["git", "rev-parse", "--path-format=absolute", "--git-dir"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

/** `git rev-parse --path-format=absolute --git-common-dir` — the SHARED git dir. */
export const GIT_COMMON_DIR_ABS: Recipe<WithCwd, string | undefined> = {
  argv: () => ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
};

/**
 * Repository-LOCAL `core.worktree` on an explicit git dir, in argv form.
 *
 * `--local` (not a merged read) is required: a merged read returns a value set
 * in `~/.gitconfig` for every linked worktree on the machine, and this value
 * feeds an authorization anchor. Argv form (not a shell string) is required
 * because the git-dir path is runtime, cwd-derived input.
 * Exit 1 = the key is unset, which is the common case, not an error.
 */
export const GIT_CONFIG_LOCAL_CORE_WORKTREE: Recipe<WithCwd & { gitDir: string }, string | undefined> = {
  argv: ({ gitDir }) => ["git", "--git-dir", gitDir, "config", "--local", "--get", "core.worktree"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
  tolerate: [1],
};

/**
 * Repository-LOCAL `core.bare` on an explicit git dir, in argv form.
 *
 * Disambiguates a BARE hub that happens to be named `.git` (e.g.
 * `git init --bare /work/repo/.git`) from an ordinary checkout's `.git`. Both
 * present an identical common-dir basename, so the basename rule alone would
 * name `/work/repo` as the main checkout of a hub that has no checkout at all —
 * an over-broad anchor for an authorization consumer. `--local` for the same
 * reason as `core.worktree`: a merged read would inherit `~/.gitconfig`.
 * Exit 1 = unset, which git treats as false.
 */
export const GIT_CONFIG_LOCAL_CORE_BARE: Recipe<WithCwd & { gitDir: string }, string | undefined> = {
  argv: ({ gitDir }) => ["git", "--git-dir", gitDir, "config", "--local", "--get", "core.bare"],
  parse: (out) => out.trim() || undefined,
  timeout: GIT_TIMEOUT,
  tolerate: [1],
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
  GIT_DIR_ABS,
  GIT_COMMON_DIR_ABS,
  GIT_CONFIG_LOCAL_CORE_WORKTREE,
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

// ── Checkout-root resolution ────────────────────────────────────────────────
// See change: add-git-checkout-root-resolver.

/**
 * The three facts a consumer actually needs about a cwd's git layout.
 *
 * They are three separate fields on purpose. `dirname(--git-common-dir)` —
 * the derivation this type replaces — collapses them into one path and is
 * wrong whenever the git dir does not sit inside the checkout it serves
 * (submodule, worktree of a submodule, `--separate-git-dir`, bare, worktree
 * of a bare hub).
 */
export interface GitCheckoutRoots {
  /** The working tree containing the cwd; `null` for a bare repository. */
  thisCheckout: string | null;
  /** True iff the per-worktree git dir differs from the shared common dir. */
  isLinkedWorktree: boolean;
  /** The repository's primary working tree; `null` when it has none. */
  mainCheckout: string | null;
}

/**
 * Injected git reads, so the resolution logic is unit-testable without
 * spawning git. The CANONICAL FORM is part of the contract — `gitDir` and
 * `commonDir` must both be absolute (`--path-format=absolute`) — because the
 * classifier compares them.
 */
export interface GitCheckoutRootProbes {
  gitDir: () => string | undefined;
  commonDir: () => string | undefined;
  topLevel: () => string | undefined;
  /** Repository-LOCAL `core.worktree` on the common dir; argv form only. */
  localCoreWorktree: (commonDir: string) => string | undefined;
  /** Repository-LOCAL `core.bare` on the common dir; argv form only. */
  localCoreBare: (commonDir: string) => string | undefined;
}

/**
 * Whether `p` contains a `.git` path COMPONENT.
 *
 * Exact segment equality, never `includes(".git")`: an ordinary checkout
 * legitimately located at `/work/app.git` must not be rejected.
 */
export function hasGitPathSegment(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return normalizePath(p, platform)
    .split(/[\\/]+/)
    .some((seg) => seg === ".git");
}

/** Call a probe, mapping any throw (timeout, missing binary) to `undefined`. */
function tryProbe(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Resolve a cwd's checkout roots from injected probes.
 *
 * `--git-dir` and `--git-common-dir` are REQUIRED: both succeeding is what
 * proves the cwd is inside a repository, and either failing yields `null` (no
 * result) rather than a path derived from a partial probe.
 *
 * `--show-toplevel` is NOT required. It fails by design in a bare repository,
 * and that failure means `thisCheckout = null` for an EXISTING repo — which is
 * what keeps bare distinguishable from non-repo, so a consumer does not fall
 * through to a non-git code path.
 *
 * `mainCheckout` is returned VERBATIM. `core.worktree` is user-controlled and
 * git does not validate it, so rule 1 may yield a nonexistent path or one
 * inside a git dir. Validating it is the CONSUMER's obligation, because the
 * safe response differs by consumer (a display consumer omits the field; an
 * authorization consumer rejects).
 *
 * `platform` governs the ISOMORPHIC string helpers only (`normalizePath` /
 * `samePath`). The `node:path` calls below are native and always follow
 * `process.platform`, so passing a foreign `platform` cross-checks comparison
 * semantics, not separator parsing.
 */
export function resolveCheckoutRootsFrom(
  probes: GitCheckoutRootProbes,
  platform: NodeJS.Platform = process.platform,
): GitCheckoutRoots | null {
  const gitDirRaw = tryProbe(probes.gitDir);
  const commonDirRaw = tryProbe(probes.commonDir);
  if (!gitDirRaw || !commonDirRaw) return null;

  const gitDir = normalizePath(gitDirRaw, platform);
  const commonDir = normalizePath(commonDirRaw, platform);
  const topLevelRaw = tryProbe(probes.topLevel);
  const thisCheckout = topLevelRaw ? normalizePath(topLevelRaw, platform) : null;

  const isLinkedWorktree = !samePath(gitDir, commonDir, platform);
  if (!isLinkedWorktree) return { thisCheckout, isLinkedWorktree, mainCheckout: thisCheckout };

  // Rule 1 — repository-local `core.worktree`, resolved against the common dir.
  const configured = tryProbe(() => probes.localCoreWorktree(commonDir));
  if (configured) {
    return {
      thisCheckout,
      isLinkedWorktree,
      mainCheckout: normalizePath(path.resolve(commonDir, configured), platform),
    };
  }
  // Rule 2 — the parent of the common dir, when the common dir is named `.git`
  // AND the repository is not bare. A bare hub may itself be named `.git`, and
  // its parent is then an ordinary directory with no checkout in it; naming it
  // would hand an authorization consumer an anchor the repo never owned.
  if (path.basename(commonDir) === ".git" && tryProbe(() => probes.localCoreBare(commonDir)) !== "true") {
    return { thisCheckout, isLinkedWorktree, mainCheckout: normalizePath(path.dirname(commonDir), platform) };
  }
  // Rule 3 — a bare hub has no working tree to name.
  return { thisCheckout, isLinkedWorktree, mainCheckout: null };
}

/**
 * Canonical wiring of {@link resolveCheckoutRootsFrom} over the git recipes.
 *
 * Every consumer SHOULD call this rather than assembling its own probes, so
 * the `--path-format=absolute` requirement cannot be got wrong per call site.
 *
 * `timeout` overrides the recipes' default per probe — a request-path guard
 * resolves three probes and must not inherit a batch-job budget.
 */
export function checkoutRoots(input: WithCwd & { timeout?: number }): GitCheckoutRoots | null {
  const ctx = { cwd: input.cwd, timeout: input.timeout };
  return resolveCheckoutRootsFrom({
    gitDir: () => unwrap(run(GIT_DIR_ABS, input, ctx), undefined),
    commonDir: () => unwrap(run(GIT_COMMON_DIR_ABS, input, ctx), undefined),
    topLevel: () => unwrap(run(GIT_TOPLEVEL, input, ctx), undefined),
    localCoreWorktree: (commonDir) =>
      unwrap(run(GIT_CONFIG_LOCAL_CORE_WORKTREE, { cwd: input.cwd, gitDir: commonDir }, ctx), undefined),
    localCoreBare: (commonDir) =>
      unwrap(run(GIT_CONFIG_LOCAL_CORE_BARE, { cwd: input.cwd, gitDir: commonDir }, ctx), undefined),
  });
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
