/**
 * Tests for listPullRequests + addWorktreeFromPr.
 * See change: add-worktree-from-pull-request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listPullRequests, addWorktreeFromPr } from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-pr-test-"));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

// ── listPullRequests ────────────────────────────────────────────────────

describe("listPullRequests", () => {
  it("parses a valid gh pr list JSON response", () => {
    // We can't call real `gh` in a fixture repo, so we mock via a script
    // that outputs canned JSON.
    const dir = mkdtempSync(join(tmpdir(), "gh-mock-"));
    const mockGh = join(dir, "gh");
    const prs = JSON.stringify([
      {
        number: 42,
        title: "Fix all the bugs",
        headRefName: "fix-all",
        headRefOid: "abc123",
        author: { login: "alice" },
        isDraft: false,
        isCrossRepository: false,
        statusCheckRollup: [{ status: "SUCCESS", conclusion: "SUCCESS" }],
      },
      {
        number: 7,
        title: "WIP: new feature",
        headRefName: "feat/new",
        headRefOid: "def456",
        author: { login: "bob" },
        isDraft: true,
        isCrossRepository: true,
        statusCheckRollup: [],
      },
      {
        number: 99,
        title: "Pending checks",
        headRefName: "pending-pr",
        headRefOid: "ghi789",
        author: { login: "carol" },
        isDraft: false,
        isCrossRepository: false,
        statusCheckRollup: [{ status: "PENDING" }],
      },
    ]);
    writeFileSync(mockGh, `#!/bin/sh\necho '${prs.replace(/'/g, "'\\''")}'`, { mode: 0o755 });

    const cwd = makeRepo();
    try {
      const result = listPullRequests({ cwd, ghPath: mockGh });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toEqual({
        number: 42,
        title: "Fix all the bugs",
        headRefName: "fix-all",
        headRefOid: "abc123",
        author: "alice",
        isDraft: false,
        isCrossRepository: false,
        checkRollup: "passing",
      });
      expect(result.data[1]!.isDraft).toBe(true);
      expect(result.data[1]!.isCrossRepository).toBe(true);
      expect(result.data[1]!.checkRollup).toBe("none");
      expect(result.data[2]!.checkRollup).toBe("pending");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns gh_not_authed on auth failure", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-mock-"));
    const mockGh = join(dir, "gh");
    writeFileSync(mockGh, `#!/bin/sh\necho "gh auth login required" >&2; exit 1`, { mode: 0o755 });

    const cwd = makeRepo();
    try {
      const result = listPullRequests({ cwd, ghPath: mockGh });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("gh_not_authed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns git_failed on malformed JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-mock-"));
    const mockGh = join(dir, "gh");
    writeFileSync(mockGh, `#!/bin/sh\necho "not json"`, { mode: 0o755 });

    const cwd = makeRepo();
    try {
      const result = listPullRequests({ cwd, ghPath: mockGh });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("git_failed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns empty array when no PRs", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-mock-"));
    const mockGh = join(dir, "gh");
    writeFileSync(mockGh, `#!/bin/sh\necho '[]'`, { mode: 0o755 });

    const cwd = makeRepo();
    try {
      const result = listPullRequests({ cwd, ghPath: mockGh });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("collapses failing check rollup correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-mock-"));
    const mockGh = join(dir, "gh");
    const prs = JSON.stringify([{
      number: 1,
      title: "t",
      headRefName: "b",
      headRefOid: "sha",
      author: { login: "u" },
      isDraft: false,
      isCrossRepository: false,
      statusCheckRollup: [
        { status: "SUCCESS", conclusion: "SUCCESS" },
        { status: "FAILURE", conclusion: "FAILURE" },
      ],
    }]);
    writeFileSync(mockGh, `#!/bin/sh\necho '${prs.replace(/'/g, "'\\''")}'`, { mode: 0o755 });

    const cwd = makeRepo();
    try {
      const result = listPullRequests({ cwd, ghPath: mockGh });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data[0]!.checkRollup).toBe("failing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ── addWorktreeFromPr ───────────────────────────────────────────────────

describe("addWorktreeFromPr", () => {
  let repo: string;
  let worktrees: string[];
  let bareRemotes: string[];

  beforeEach(() => {
    repo = makeRepo();
    worktrees = [];
    bareRemotes = [];
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo.
    for (const wt of worktrees) {
      try { git(`worktree remove --force ${wt}`, repo); } catch {}
    }
    rmSync(repo, { recursive: true, force: true });
    for (const r of bareRemotes) {
      rmSync(r, { recursive: true, force: true });
    }
  });

  /**
   * Simulate a PR by creating a ref that mimics GitHub's refs/pull/<N>/head.
   * We push a branch to a local bare remote and manually create the ref.
   */
  function simulatePr(prNumber: number, commitMsg = "PR commit"): void {
    // Create a bare remote.
    const remote = mkdtempSync(join(tmpdir(), "bare-remote-"));
    bareRemotes.push(remote);
    git("init --bare", remote);
    git(`remote add origin ${remote}`, repo);
    git("push origin main", repo);

    // Create a branch with a new commit, push it, and create refs/pull/N/head.
    git(`checkout -b pr-branch-${prNumber}`, repo);
    writeFileSync(join(repo, `pr-${prNumber}.txt`), commitMsg);
    git("add .", repo);
    git(`commit -m "${commitMsg}"`, repo);
    git("push origin HEAD", repo);

    // Create the refs/pull/N/head ref on the remote, pointing at the branch tip.
    const sha = git("rev-parse HEAD", repo);
    execSync(`git update-ref refs/pull/${prNumber}/head ${sha}`, {
      cwd: remote,
      stdio: "pipe",
    });

    // Switch back to main.
    git("checkout main", repo);
  }

  it("creates a worktree from a simulated PR ref", () => {
    simulatePr(42, "feat: PR 42");
    const result = addWorktreeFromPr({ cwd: repo, prNumber: 42 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.branch).toBe("pr-42");
    expect(result.prNumber).toBe(42);
    expect(existsSync(result.path)).toBe(true);
    worktrees.push(result.path);

    // Verify the worktree HEAD is at the PR commit.
    const head = git("rev-parse HEAD", result.path);
    const prHead = git("rev-parse refs/pr/42", repo);
    expect(head).toBe(prHead);

    // Verify main checkout is untouched.
    const mainHead = git("rev-parse HEAD", repo);
    expect(mainHead).not.toBe(head);
  });

  it("returns branch_exists on re-checkout collision", () => {
    simulatePr(42);
    const first = addWorktreeFromPr({ cwd: repo, prNumber: 42 });
    expect(first.ok).toBe(true);
    if (first.ok) worktrees.push(first.path);

    const second = addWorktreeFromPr({ cwd: repo, prNumber: 42 });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(["branch_exists", "branch_in_use", "path_exists"]).toContain(second.error);
    }
  });

  it("returns pr_not_found for nonexistent PR ref", () => {
    // Set up a remote but don't create a PR ref.
    const remote = mkdtempSync(join(tmpdir(), "bare-remote-"));
    git("init --bare", remote);
    git(`remote add origin ${remote}`, repo);
    git("push origin main", repo);

    const result = addWorktreeFromPr({ cwd: repo, prNumber: 999 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("pr_not_found");
    }
    rmSync(remote, { recursive: true, force: true });
  });

  it("returns not_a_repo for non-git directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "not-git-"));
    const result = addWorktreeFromPr({ cwd: dir, prNumber: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_a_repo");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses explicit path when provided", () => {
    simulatePr(10);
    const customPath = join(tmpdir(), `custom-wt-${Date.now()}`);
    const result = addWorktreeFromPr({ cwd: repo, prNumber: 10, path: customPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
    worktrees.push(customPath);
  });
});
