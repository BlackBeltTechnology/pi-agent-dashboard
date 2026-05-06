import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync as rawExecSync } from "node:child_process";
import {
  addWorktree,
  listWorktrees,
  removeWorktree,
  resolveRepoRoot,
  isInsideWorkTree,
  ensureWorktreesDir,
  generateWorktreePath,
  WORKTREES_DIR,
} from "../worktree-manager.js";

// ── Test helpers ──────────────────────────────────────────────────────────

let testDir: string;
let repoRoot: string;

function exec(cmd: string, cwd: string): string {
  return rawExecSync(cmd, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 15_000 }).trim();
}

function setupGitRepo(): void {
  testDir = path.join(os.tmpdir(), `worktree-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(testDir, { recursive: true });
  const rawRepoRoot = path.join(testDir, "repo");
  mkdirSync(rawRepoRoot, { recursive: true });
  exec("git init", rawRepoRoot);
  exec("git config user.email \"test@test.com\"", rawRepoRoot);
  exec("git config user.name \"Test\"", rawRepoRoot);
  writeFileSync(path.join(rawRepoRoot, "README.md"), "# test\n", "utf-8");
  exec("git add README.md", rawRepoRoot);
  exec("git commit -m \"initial\"", rawRepoRoot);
  exec("git branch feature-x", rawRepoRoot);
  // Canonicalize repoRoot to match git's internal path (handles macOS /var→/private/var symlinks)
  repoRoot = resolveRepoRoot(rawRepoRoot);
}

function cleanup(): void {
  try {
    if (testDir && existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("worktree-manager", () => {
  beforeEach(setupGitRepo);
  afterEach(cleanup);

  describe("resolveRepoRoot", () => {
    it("resolves repo root from a subdirectory", () => {
      const subDir = path.join(repoRoot, "sub");
      mkdirSync(subDir, { recursive: true });
      expect(resolveRepoRoot(subDir)).toBe(repoRoot);
    });

    it("resolves repo root from repo root itself", () => {
      expect(resolveRepoRoot(repoRoot)).toBe(repoRoot);
    });
  });

  describe("isInsideWorkTree", () => {
    it("returns true for a git repo", () => {
      expect(isInsideWorkTree(repoRoot)).toBe(true);
    });

    it("returns false for a non-git directory", () => {
      const nonGit = path.join(testDir, "non-git");
      mkdirSync(nonGit, { recursive: true });
      expect(isInsideWorkTree(nonGit)).toBe(false);
    });
  });

  describe("ensureWorktreesDir", () => {
    it("creates .pi/worktrees/ directory and adds .pi/ to .gitignore", () => {
      ensureWorktreesDir(repoRoot);
      const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
      expect(existsSync(worktreesDir)).toBe(true);
      const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
      expect(gitignore).toContain(`.pi/`);
    });

    it("is idempotent — does not double-add to gitignore", () => {
      ensureWorktreesDir(repoRoot);
      ensureWorktreesDir(repoRoot);
      const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
      const matches = (gitignore.match(/\.pi\//g) || []).length;
      expect(matches).toBe(1);
    });

    it("appends to existing .gitignore", () => {
      writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n", "utf-8");
      ensureWorktreesDir(repoRoot);
      const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
      expect(gitignore).toContain("node_modules/");
      expect(gitignore).toContain(`.pi/`);
    });
  });

  describe("generateWorktreePath", () => {
    it("generates path inside repo .pi/worktrees/ with branch slug and timestamp", () => {
      const wp = generateWorktreePath(repoRoot, "feature-x");
      const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
      expect(wp.startsWith(worktreesDir)).toBe(true);
      expect(wp).toMatch(/feature-x-\d+/);
    });

    it("includes label slug when provided", () => {
      const wp = generateWorktreePath(repoRoot, "feature-x", "My Label!");
      expect(wp).toMatch(/my-label-feature-x-\d+/);
    });

    it("slugifies special characters in branch", () => {
      const wp = generateWorktreePath(repoRoot, "feature/X_Y.Z");
      expect(wp).toMatch(/feature-x_y\.z-\d+/);
    });
  });

  describe("addWorktree with baseBranch", () => {
    it("creates a new branch from base and worktree on it", () => {
      const result = addWorktree(repoRoot, "feature-from-develop", {
        baseBranch: "feature-x",
      });
      expect(existsSync(result.path)).toBe(true);
      expect(result.branch).toBe("feature-from-develop");
      // Verify it's a real checkout on the new branch
      const head = exec("git rev-parse --abbrev-ref HEAD", result.path);
      expect(head).toBe("feature-from-develop");
      // Verify it branched from feature-x (same HEAD commit)
      const baseSha = exec("git rev-parse refs/heads/feature-x", repoRoot);
      const newSha = exec("git rev-parse HEAD", result.path);
      expect(newSha).toBe(baseSha);
    });

    it("throws branch_not_found when base branch doesn't exist", () => {
      try {
        addWorktree(repoRoot, "new-branch", { baseBranch: "nonexistent" });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("branch_not_found");
        expect(err.message).toContain("Base branch");
      }
    });

    it("throws when new branch name already exists", () => {
      // git worktree add -b <existing> fails: "a branch named 'X' already exists"
      try {
        addWorktree(repoRoot, "feature-x", { baseBranch: "main" });
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("branch_already_checked_out");
      }
    });
  });

  describe("addWorktree", () => {
    it("creates a worktree for an existing branch", () => {
      const result = addWorktree(repoRoot, "feature-x");
      expect(existsSync(result.path)).toBe(true);
      expect(result.branch).toBe("feature-x");
      // Verify it's a real git checkout
      const head = exec("git rev-parse --abbrev-ref HEAD", result.path);
      expect(head).toBe("feature-x");
    });

    it("creates worktree with label in path", () => {
      const result = addWorktree(repoRoot, "feature-x", { label: "review" });
      expect(result.path).toMatch(/review-feature-x-\d+/);
    });

    it("throws with code 'branch_not_found' for non-existent branch", () => {
      try {
        addWorktree(repoRoot, "nonexistent-branch-zzz");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("branch_not_found");
        expect(err.message).toContain("not found");
      }
    });

    it("throws with code 'not_a_git_repo' for non-git directory", () => {
      const nonGit = path.join(testDir, "not-a-repo");
      mkdirSync(nonGit, { recursive: true });
      try {
        addWorktree(nonGit, "main");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("not_a_git_repo");
      }
    });

    it("two sequential addWorktree calls on different branches produce different paths", () => {
      // Create another branch for the second worktree (git prevents same branch in two worktrees)
      exec("git branch feature-y", repoRoot);
      const result = addWorktree(repoRoot, "feature-x");
      const result2 = addWorktree(repoRoot, "feature-y");
      expect(result2.path).not.toBe(result.path);
      expect(existsSync(result.path)).toBe(true);
      expect(existsSync(result2.path)).toBe(true);
    });

    it("throws when branch name contains unsafe characters", () => {
      try {
        addWorktree(repoRoot, "evil; rm -rf /");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("branch_not_found");
        expect(err.message).toContain("Invalid");
      }
    });

    it("ensures .pi/worktrees/ directory and .gitignore on first creation", () => {
      const worktreesDir = path.join(repoRoot, WORKTREES_DIR);
      // Should not exist yet
      if (existsSync(worktreesDir)) {
        rmSync(worktreesDir, { recursive: true, force: true });
      }
      addWorktree(repoRoot, "feature-x");
      expect(existsSync(worktreesDir)).toBe(true);
      const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf-8");
      expect(gitignore).toContain(`.pi/`);
    });
  });

  describe("listWorktrees", () => {
    it("returns main worktree before any additions", () => {
      const wt = listWorktrees(repoRoot);
      expect(wt.length).toBe(1);
      expect(wt[0].isMain).toBe(true);
      expect(wt[0].path).toBe(repoRoot);
    });

    it("lists all worktrees after adding", () => {
      addWorktree(repoRoot, "feature-x");
      const wt = listWorktrees(repoRoot);
      expect(wt.length).toBe(2);
      const main = wt.find((w) => w.isMain);
      const added = wt.find((w) => !w.isMain);
      expect(main).toBeDefined();
      expect(added).toBeDefined();
      expect(added!.branch).toBe("feature-x");
    });

    it("returns empty array for non-git directories", () => {
      const nonGit = path.join(testDir, "non-git");
      mkdirSync(nonGit, { recursive: true });
      expect(listWorktrees(nonGit)).toEqual([]);
    });
  });

  describe("removeWorktree", () => {
    it("removes a dashboard-managed worktree", () => {
      const { path: wp } = addWorktree(repoRoot, "feature-x");
      expect(existsSync(wp)).toBe(true);
      removeWorktree(repoRoot, wp);
      expect(existsSync(wp)).toBe(false);
    });

    it("throws 'not_a_worktree' for non-existent path", () => {
      const fakePath = path.join(path.dirname(repoRoot), WORKTREES_DIR, "nope-12345");
      try {
        removeWorktree(repoRoot, fakePath);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("not_a_worktree");
      }
    });

    it("throws 'cannot_remove_main_worktree' for main worktree", () => {
      try {
        removeWorktree(repoRoot, repoRoot);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("cannot_remove_main_worktree");
      }
    });

    it("throws 'external_worktree_readonly' for worktrees outside .pi-worktrees/", () => {
      // Create a worktree outside .pi-worktrees/ manually
      const externalPathRaw = path.join(testDir, `external-wt-${Date.now()}`);
      exec(`git worktree add "${externalPathRaw}" feature-x`, repoRoot);
      // git worktree list reports canonicalized paths; find the real path
      const worktrees = listWorktrees(repoRoot);
      const ext = worktrees.find((w) => !w.isMain && !w.path.includes(WORKTREES_DIR));
      if (!ext) throw new Error("Could not find the external worktree in list");
      try {
        removeWorktree(repoRoot, ext.path);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("external_worktree_readonly");
      }
      // Cleanup
      try { exec(`git worktree remove --force "${ext.path}"`, repoRoot); } catch { /* ignore */ }
    });

    it("throws 'not_a_git_repo' for non-git directory", () => {
      const nonGit = path.join(testDir, "not-a-repo");
      mkdirSync(nonGit, { recursive: true });
      try {
        removeWorktree(nonGit, "/some/path");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("not_a_git_repo");
      }
    });
  });
});
