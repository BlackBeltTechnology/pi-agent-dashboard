/**
 * Pure stderr → stable error-code mappers for the four worktree
 * lifecycle operations: remove, merge, push, pr. Each mapper accepts a
 * stderr string (from `git` or `gh`) and returns a stable code that
 * REST routes surface verbatim to clients.
 *
 * Stderr wording varies across git / gh versions; matchers are
 * deliberately loose. Unrecognised strings fall through to a generic
 * `git_failed` (or `gh_failed`-ish equivalent) which the caller maps to
 * HTTP 500.
 *
 * See change: add-worktree-lifecycle-actions.
 */

// ── Codes ──────────────────────────────────────────────────────────

export type RemoveCode =
  | "ok"
  | "dirty_worktree"
  | "branch_not_merged"
  | "not_a_worktree"
  | "git_failed";

export type MergeCode =
  | "ok"
  | "merge_conflict"
  | "base_not_found"
  | "nothing_to_merge"
  | "git_failed";

export type PushCode =
  | "ok"
  | "no_remote"
  | "auth_failed"
  | "non_fast_forward"
  | "git_failed";

export type PrCode =
  | "ok"
  | "gh_not_authed"
  | "pr_exists"
  | "base_not_found"
  | "git_failed";

// ── Mappers ────────────────────────────────────────────────────────

/**
 * Map `git worktree remove` stderr → stable code. Generous matching:
 * `--reason` argument names + git's wording across versions.
 */
export function mapRemoveStderr(stderr: string): RemoveCode {
  const s = stderr.toLowerCase();
  if (
    /contains modified or untracked files|uncommitted change|use --force/i.test(stderr) ||
    /is dirty/.test(s)
  ) return "dirty_worktree";
  if (/not fully merged|not merged|has unmerged commit/i.test(stderr)) return "branch_not_merged";
  if (/is not a working tree|not a git repository|is not a worktree/i.test(stderr)) return "not_a_worktree";
  return "git_failed";
}

/**
 * Map `git merge` / `git checkout` stderr → stable code.
 *
 * `merge_conflict` only fires when stderr contains explicit conflict
 * wording — caller is expected to detect non-zero exit + conflict
 * markers and pass the merge's stderr in.
 */
export function mapMergeStderr(stderr: string): MergeCode {
  const s = stderr.toLowerCase();
  if (/conflict|automatic merge failed/i.test(s)) return "merge_conflict";
  if (/already up.to.date|nothing to commit/i.test(s)) return "nothing_to_merge";
  if (
    /pathspec.*did not match|unknown revision|not a valid object name|invalid reference/i.test(stderr)
  ) return "base_not_found";
  return "git_failed";
}

/**
 * Map `git push` stderr → stable code.
 */
export function mapPushStderr(stderr: string): PushCode {
  const s = stderr.toLowerCase();
  // Auth failures: explicit auth wording wins (auth-related "rejected"
  // language should not be misclassified as non-fast-forward).
  if (
    /authentication failed|permission denied|could not read username|kex_exchange_identification|host key verification|terminal prompts disabled/i.test(s)
  ) return "auth_failed";
  if (
    /no such remote|does not appear to be a git repository|no configured push destination|origin.*does not appear/i.test(s)
  ) return "no_remote";
  if (
    /non-fast-forward|rejected.*fetch first|updates were rejected/i.test(s)
  ) return "non_fast_forward";
  return "git_failed";
}

/**
 * Map `gh pr create` stderr → stable code. `gh_not_found` is detected
 * outside the mapper (it's a tool-registry resolution failure, not
 * stderr from gh).
 */
export function mapPrStderr(stderr: string): PrCode {
  const s = stderr.toLowerCase();
  if (
    /not logged in|authentication required|gh auth login|http 401/i.test(s)
  ) return "gh_not_authed";
  if (
    /a pull request for branch .* already exists|pull request .* already exists/i.test(s)
  ) return "pr_exists";
  if (
    /base branch .* does not exist|could not resolve.*base|unknown.*ref/i.test(s)
  ) return "base_not_found";
  return "git_failed";
}

// ── URL parsing ─────────────────────────────────────────────────────

/**
 * Extract a GitHub PR URL from `gh pr create` stdout. gh prints the URL
 * as the only line of stdout on success; we also tolerate surrounding
 * whitespace and an "Opening … in your browser." trailer (`gh pr create
 * --web` would print that, but our caller doesn't pass `--web`).
 */
export function parsePrUrl(stdout: string): string | null {
  const m = stdout.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

/**
 * Parse `git diff --shortstat` ("1 file changed, 2 insertions(+), 3
 * deletions(-)") into a structured object. All fields default to 0
 * when missing.
 */
export function parseShortstat(stdout: string): {
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const filesM = stdout.match(/(\d+)\s+files? changed/);
  const insM = stdout.match(/(\d+)\s+insertions?\(\+\)/);
  const delM = stdout.match(/(\d+)\s+deletions?\(-\)/);
  return {
    filesChanged: filesM ? Number(filesM[1]) : 0,
    insertions: insM ? Number(insM[1]) : 0,
    deletions: delM ? Number(delM[1]) : 0,
  };
}
