/**
 * Base resolution + changed-file diff for the affected-test selector.
 *
 * Rename detection is OFF (`--no-renames`), so a rename reports both its old
 * and new path, and deletions are listed — a test reading the old path must
 * still be selected. Any base the selector cannot trust yields `{ full }`:
 * the all-zero push `before` of a new branch, an unresolvable ref, or a base
 * that is not an ancestor of head (force-push). See change:
 * speed-up-ci-affected-tests (D5 `select`).
 */
import { execFileSync } from "node:child_process";

const ZERO_SHA = /^0+$/;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function tryGit(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) };
  } catch (e) {
    return { ok: false, out: String(e.stderr ?? e.message ?? e) };
  }
}

/** Changed paths between two commits, both sides of a rename, deletions included. */
export function changedFiles(base, head, cwd) {
  return git(cwd, ["diff", "--no-renames", "--name-only", base, head])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
}

/**
 * @param {{ base: string, head?: string, cwd: string, mergeBase?: boolean }} opts
 *   mergeBase: diff from `git merge-base <base> <head>` (pull requests).
 * @returns {{ changed: string[], base: string } | { full: string }}
 */
export function resolveDiff({ base, head = "HEAD", cwd, mergeBase = false }) {
  if (!base) return { full: "no base ref given" };
  if (ZERO_SHA.test(base)) return { full: `base ${base} is the all-zero SHA (new branch push)` };
  const resolved = tryGit(cwd, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (!resolved.ok) return { full: `base ref ${base} cannot be resolved in the checkout` };
  let baseSha = resolved.out.trim();
  if (mergeBase) {
    const mb = tryGit(cwd, ["merge-base", baseSha, head]);
    if (!mb.ok) return { full: `no merge-base between ${base} and ${head}` };
    baseSha = mb.out.trim();
  } else if (!tryGit(cwd, ["merge-base", "--is-ancestor", baseSha, head]).ok) {
    return { full: `base ${base} is not an ancestor of ${head} (force-push)` };
  }
  return { changed: changedFiles(baseSha, head, cwd), base: baseSha };
}
