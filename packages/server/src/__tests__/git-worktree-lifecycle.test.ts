/**
 * Tests for the four pure stderr→code mappers in
 * `git-worktree-lifecycle.ts`. Each mapper has 6+ arms covering the
 * documented error envelope plus the catch-all `git_failed`.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import { describe, it, expect } from "vitest";
import {
  mapRemoveStderr,
  mapMergeStderr,
  mapPushStderr,
  mapPrStderr,
  parsePrUrl,
  parseShortstat,
} from "../git-worktree/git-worktree-lifecycle.js";

describe("mapRemoveStderr", () => {
  it("dirty_worktree on 'contains modified or untracked files'", () => {
    expect(mapRemoveStderr("fatal: '<wt>' contains modified or untracked files, use --force"))
      .toBe("dirty_worktree");
  });
  it("dirty_worktree on 'uncommitted changes'", () => {
    expect(mapRemoveStderr("error: worktree has uncommitted changes")).toBe("dirty_worktree");
  });
  it("branch_not_merged on 'not fully merged'", () => {
    expect(mapRemoveStderr("error: branch 'x' is not fully merged"))
      .toBe("branch_not_merged");
  });
  it("branch_not_merged on 'has unmerged commits'", () => {
    expect(mapRemoveStderr("error: branch has unmerged commits"))
      .toBe("branch_not_merged");
  });
  it("not_a_worktree on 'is not a working tree'", () => {
    expect(mapRemoveStderr("fatal: '/tmp/x' is not a working tree"))
      .toBe("not_a_worktree");
  });
  it("not_a_worktree on 'not a git repository'", () => {
    expect(mapRemoveStderr("fatal: not a git repository")).toBe("not_a_worktree");
  });
  it("git_failed on unrecognised stderr", () => {
    expect(mapRemoveStderr("some other failure")).toBe("git_failed");
  });
  it("git_failed on empty stderr", () => {
    expect(mapRemoveStderr("")).toBe("git_failed");
  });
});

describe("mapMergeStderr", () => {
  it("merge_conflict on 'CONFLICT'", () => {
    expect(mapMergeStderr("CONFLICT (content): Merge conflict in foo")).toBe("merge_conflict");
  });
  it("merge_conflict on 'Automatic merge failed'", () => {
    expect(mapMergeStderr("Automatic merge failed; fix conflicts and then commit"))
      .toBe("merge_conflict");
  });
  it("nothing_to_merge on 'Already up to date'", () => {
    expect(mapMergeStderr("Already up to date.")).toBe("nothing_to_merge");
  });
  it("base_not_found on 'pathspec did not match'", () => {
    expect(mapMergeStderr("error: pathspec 'develop' did not match any file(s) known to git"))
      .toBe("base_not_found");
  });
  it("base_not_found on 'unknown revision'", () => {
    expect(mapMergeStderr("fatal: unknown revision: develop")).toBe("base_not_found");
  });
  it("base_not_found on 'invalid reference'", () => {
    expect(mapMergeStderr("error: invalid reference: develop")).toBe("base_not_found");
  });
  it("git_failed on unrecognised stderr", () => {
    expect(mapMergeStderr("disk full")).toBe("git_failed");
  });
  it("git_failed on empty stderr", () => {
    expect(mapMergeStderr("")).toBe("git_failed");
  });
});

describe("mapPushStderr", () => {
  it("auth_failed on 'Authentication failed'", () => {
    expect(mapPushStderr("fatal: Authentication failed for 'https://github.com/x.git/'"))
      .toBe("auth_failed");
  });
  it("auth_failed on 'Permission denied'", () => {
    expect(mapPushStderr("Permission denied (publickey)")).toBe("auth_failed");
  });
  it("auth_failed on 'could not read Username'", () => {
    expect(mapPushStderr("fatal: could not read Username for 'https://github.com'"))
      .toBe("auth_failed");
  });
  it("no_remote on 'does not appear to be a git repository'", () => {
    expect(mapPushStderr("fatal: 'origin' does not appear to be a git repository"))
      .toBe("no_remote");
  });
  it("no_remote on 'no configured push destination'", () => {
    expect(mapPushStderr("fatal: No configured push destination."))
      .toBe("no_remote");
  });
  it("non_fast_forward on 'non-fast-forward'", () => {
    expect(mapPushStderr("error: failed to push some refs (non-fast-forward)"))
      .toBe("non_fast_forward");
  });
  it("non_fast_forward on 'updates were rejected'", () => {
    expect(mapPushStderr("hint: Updates were rejected because the remote contains work that you do not have"))
      .toBe("non_fast_forward");
  });
  it("git_failed on unrecognised stderr", () => {
    expect(mapPushStderr("disk full")).toBe("git_failed");
  });
});

describe("mapPrStderr", () => {
  it("gh_not_authed on 'not logged in'", () => {
    expect(mapPrStderr("error: not logged in to github.com — run 'gh auth login'"))
      .toBe("gh_not_authed");
  });
  it("gh_not_authed on 'authentication required'", () => {
    expect(mapPrStderr("authentication required")).toBe("gh_not_authed");
  });
  it("gh_not_authed on 'HTTP 401'", () => {
    expect(mapPrStderr("HTTP 401: Bad credentials")).toBe("gh_not_authed");
  });
  it("pr_exists on 'already exists'", () => {
    expect(mapPrStderr("a pull request for branch 'foo' already exists: https://x/pulls/1"))
      .toBe("pr_exists");
  });
  it("base_not_found on 'does not exist'", () => {
    expect(mapPrStderr("base branch 'develop' does not exist")).toBe("base_not_found");
  });
  it("base_not_found on 'could not resolve base'", () => {
    expect(mapPrStderr("could not resolve to a base ref")).toBe("base_not_found");
  });
  it("git_failed on unrecognised stderr", () => {
    expect(mapPrStderr("disk full")).toBe("git_failed");
  });
  it("git_failed on empty", () => {
    expect(mapPrStderr("")).toBe("git_failed");
  });
});

describe("parsePrUrl", () => {
  it("extracts URL from stdout", () => {
    expect(parsePrUrl("https://github.com/foo/bar/pull/42\n")).toBe("https://github.com/foo/bar/pull/42");
  });
  it("returns null when no URL", () => {
    expect(parsePrUrl("done.")).toBeNull();
  });
});

describe("parseShortstat", () => {
  it("parses full shortstat", () => {
    expect(parseShortstat(" 3 files changed, 12 insertions(+), 5 deletions(-)"))
      .toEqual({ filesChanged: 3, insertions: 12, deletions: 5 });
  });
  it("parses with no deletions", () => {
    expect(parseShortstat(" 1 file changed, 4 insertions(+)"))
      .toEqual({ filesChanged: 1, insertions: 4, deletions: 0 });
  });
  it("returns zeros on empty", () => {
    expect(parseShortstat("")).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});
