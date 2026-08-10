/**
 * Integration tests for the three worktree operations in
 * `git-operations.ts` (readHead, listWorktrees, addWorktree).
 *
 * Uses a real tmpdir git repo + real git invocations — no mocks. Tests
 * are skipped on platforms without `git` on PATH (the suite never runs
 * in such environments, but be defensive).
 *
 * See change: add-worktree-spawn-dialog.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addWorktree, listWorktrees, readHead } from "../git-worktree/git-operations.js";

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function makeRepo(): string {
  // realpathSync to dereference `/tmp` → `/private/tmp` on macOS so paths
  // returned by `git rev-parse --git-common-dir` (which itself realpaths)
  // match what the test expects to compare against.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "git-wt-test-")));
  git("-c init.defaultBranch=main init", dir);
  git("config user.email test@test.com", dir);
  git("config user.name Test", dir);
  writeFileSync(join(dir, "README.md"), "init");
  git("add .", dir);
  git("commit -m init", dir);
  return dir;
}

describe("readHead", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns branch=main, detached=false on a fresh repo", () => {
    const head = readHead(repo);
    expect(head.branch).toBe("main");
    expect(head.detached).toBe(false);
    expect(head.sha).toMatch(/^[0-9a-f]{4,}$/);
  });

  it("returns branch=null, detached=true after checkout of a SHA", () => {
    const sha = git("rev-parse HEAD", repo);
    git(`checkout ${sha}`, repo);
    const head = readHead(repo);
    expect(head.branch).toBeNull();
    expect(head.detached).toBe(true);
    expect(head.sha).toMatch(/^[0-9a-f]{4,}$/);
  });
});

describe("listWorktrees", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns the main worktree only on a fresh repo", () => {
    const wts = listWorktrees(repo);
    expect(wts).toHaveLength(1);
    expect(wts[0]?.isMain).toBe(true);
    expect(wts[0]?.branch).toBe("main");
  });

  it("returns main + sibling worktree after addWorktree", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x" });
    expect(res.ok).toBe(true);
    const wts = listWorktrees(repo);
    expect(wts).toHaveLength(2);
    const main = wts.find((w) => w.isMain);
    const sibling = wts.find((w) => !w.isMain);
    expect(main?.branch).toBe("main");
    expect(sibling?.branch).toBe("feat/x");
  });
});

describe("addWorktree", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("creates a worktree under .worktrees/<slug>", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/dark-mode" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(join(repo, ".worktrees", "feat-dark-mode"));
    expect(res.branch).toBe("feat/dark-mode");
    expect(existsSync(res.path)).toBe(true);
    expect(existsSync(join(res.path, "README.md"))).toBe(true);
  });

  it("appends .worktrees/ to .git/info/exclude on first create", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/a" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.excludeAppended).toBe(true);
    const excludeContent = readFileSync(join(repo, ".git", "info", "exclude"), "utf-8");
    expect(excludeContent).toMatch(/^\.worktrees\/$/m);
  });

  it("does NOT re-append on a second create", () => {
    addWorktree({ cwd: repo, base: "main", newBranch: "feat/a" });
    const res2 = addWorktree({ cwd: repo, base: "main", newBranch: "feat/b" });
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.excludeAppended).toBe(false);
    const excludeContent = readFileSync(join(repo, ".git", "info", "exclude"), "utf-8");
    const matches = excludeContent.match(/^\.worktrees\/$/gm) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("does NOT touch .git/info/exclude when an explicit path is supplied", () => {
    const explicit = join(tmpdir(), `wt-explicit-${Date.now()}`);
    try {
      const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x", path: explicit });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.excludeAppended).toBe(false);
      // Exclude file may or may not exist (git creates it lazily); when it
      // does, it shouldn't carry our line.
      const excludeFile = join(repo, ".git", "info", "exclude");
      if (existsSync(excludeFile)) {
        const content = readFileSync(excludeFile, "utf-8");
        expect(content).not.toMatch(/^\.worktrees\/$/m);
      }
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });

  it("returns branch_in_use / branch_exists when newBranch collides", () => {
    // First worktree creates branch `feat/already` and a worktree dir.
    const first = addWorktree({ cwd: repo, base: "main", newBranch: "feat/already" });
    expect(first.ok).toBe(true);
    // Second worktree: SAME branch, EXPLICIT distinct path so the
    // pre-flight path_exists check doesn't preempt the git failure we
    // actually want to test.
    const altPath = mkdtempSync(join(tmpdir(), "wt-alt-"));
    // mkdtempSync creates a directory, but git needs the target to NOT
    // exist or to be empty; remove it so git creates a fresh one.
    rmSync(altPath, { recursive: true, force: true });
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/already", path: altPath });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Either `branch_in_use` or `branch_exists` is acceptable since git's
    // exact wording varies; both indicate the same user-visible failure.
    expect(["branch_in_use", "branch_exists"]).toContain(res.error);
  });

  it("returns base_not_found for an unknown base ref", () => {
    const res = addWorktree({ cwd: repo, base: "does-not-exist", newBranch: "feat/x" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("base_not_found");
  });

  it("returns path_exists when target path is non-empty", () => {
    const collide = join(repo, ".worktrees", "feat-x");
    // Pre-create the path with a file in it.
    execSync(`mkdir -p '${collide}' && echo hi > '${collide}/file.txt'`);
    try {
      const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("path_exists");
    } finally {
      rmSync(join(repo, ".worktrees"), { recursive: true, force: true });
    }
  });

  it("returns not_a_repo for a non-git cwd", () => {
    const plain = mkdtempSync(join(tmpdir(), "no-git-"));
    try {
      const res = addWorktree({ cwd: plain, base: "main", newBranch: "feat/x" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe("not_a_repo");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("resolves the parent repo even when called from a sibling worktree", () => {
    // Create a worktree, then call addWorktree from INSIDE that worktree.
    const first = addWorktree({ cwd: repo, base: "main", newBranch: "feat/first" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const res = addWorktree({ cwd: first.path, base: "main", newBranch: "feat/second" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // New worktree's derived path should be under the ORIGINAL repo's
    // `.worktrees/`, NOT under the first worktree's path.
    expect(res.path).toBe(join(repo, ".worktrees", "feat-second"));
    expect(readdirSync(join(repo, ".worktrees")).sort()).toEqual(["feat-first", "feat-second"]);
  });
});

// Checkout mode = addWorktree without `newBranch`. Checks out an existing
// branch ref directly (DWIM-creating a tracking branch for remote-only
// refs). See change: worktree-checkout-existing-branch.
describe("addWorktree — checkout mode", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("checks out an existing local branch (no -b)", () => {
    git("branch stale-feature", repo);
    const res = addWorktree({ cwd: repo, base: "stale-feature" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBe(join(repo, ".worktrees", "stale-feature"));
    expect(res.branch).toBe("stale-feature");
    // The worktree HEAD is the existing branch, not a fork.
    const head = git("rev-parse --abbrev-ref HEAD", res.path);
    expect(head).toBe("stale-feature");
  });

  it("DWIM-creates a local branch for a remote-only ref, slug drops the remote prefix", () => {
    git("branch old-experiment", repo);
    const clone = mkdtempSync(join(tmpdir(), "wt-clone-"));
    rmSync(clone, { recursive: true, force: true });
    try {
      execSync(`git clone '${repo}' '${clone}'`, { stdio: "pipe" });
      git("config user.email test@test.com", clone);
      git("config user.name Test", clone);
      // Clone's default branch is checked out; `origin/old-experiment`
      // exists as a remote-tracking ref with no local branch.
      const res = addWorktree({ cwd: clone, base: "origin/old-experiment" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      // Path slug is the LOCAL name, not `origin-old-experiment`.
      expect(res.path).toBe(join(clone, ".worktrees", "old-experiment"));
      expect(res.branch).toBe("old-experiment");
      // git DWIM-created local `old-experiment` tracking origin.
      const head = git("rev-parse --abbrev-ref HEAD", res.path);
      expect(head).toBe("old-experiment");
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it("branch_in_use message includes the holding-worktree path", () => {
    git("branch foo", repo);
    const first = addWorktree({ cwd: repo, base: "foo" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Second checkout of the SAME branch at an explicit distinct path so
    // the pre-flight path check doesn't preempt git's branch_in_use.
    const altPath = mkdtempSync(join(tmpdir(), "wt-alt-"));
    rmSync(altPath, { recursive: true, force: true });
    const res = addWorktree({ cwd: repo, base: "foo", path: altPath });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("branch_in_use");
    // Message names the worktree currently holding `foo`.
    expect(res.message).toContain(first.path);
  });
});
