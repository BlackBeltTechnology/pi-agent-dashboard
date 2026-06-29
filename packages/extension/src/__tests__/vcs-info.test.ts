/**
 * Tests for vcs-info.ts.
 *
 * The file delegates to `@blackbelt-technology/pi-dashboard-shared/platform/git.js`
 * (the Recipe-based tool module). We mock that module so the tests focus
 * on the orchestration logic (branch detection, detached HEAD fallback,
 * PR detection) without spawning git.
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { currentBranchOr, headShaOr, remoteUrlOr, prNumberOr, commonDirOr, toplevelOr } = vi.hoisted(() => ({
  currentBranchOr: vi.fn(),
  headShaOr: vi.fn(),
  remoteUrlOr: vi.fn(),
  prNumberOr: vi.fn(),
  commonDirOr: vi.fn(),
  toplevelOr: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", () => ({
  currentBranchOr,
  headShaOr,
  remoteUrlOr,
  prNumberOr,
  commonDirOr,
  toplevelOr,
}));

import { gatherGitInfo, detectBranch, detectRemoteUrl, detectPrNumber, detectWorktree } from "../vcs-info.js";

describe("git-info", () => {
  beforeEach(() => {
    currentBranchOr.mockReset();
    headShaOr.mockReset();
    remoteUrlOr.mockReset();
    prNumberOr.mockReset();
    commonDirOr.mockReset();
    toplevelOr.mockReset();
  });

  describe("detectBranch", () => {
    it("returns branch name", () => {
      currentBranchOr.mockReturnValue("main");
      expect(detectBranch("/test")).toBe("main");
    });

    it("returns undefined when not a git repo", () => {
      currentBranchOr.mockReturnValue(undefined);
      expect(detectBranch("/test")).toBeUndefined();
    });

    it("returns short SHA for detached HEAD", () => {
      currentBranchOr.mockReturnValue("HEAD");
      headShaOr.mockReturnValue("abc1234");
      expect(detectBranch("/test")).toBe("abc1234");
    });

    it("returns 'HEAD' as fallback if short SHA fails", () => {
      currentBranchOr.mockReturnValue("HEAD");
      headShaOr.mockReturnValue(undefined);
      expect(detectBranch("/test")).toBe("HEAD");
    });
  });

  describe("detectRemoteUrl", () => {
    it("returns origin remote URL", () => {
      remoteUrlOr.mockReturnValue("git@github.com:org/repo.git");
      expect(detectRemoteUrl("/test")).toBe("git@github.com:org/repo.git");
    });

    it("returns undefined when no remote is configured", () => {
      remoteUrlOr.mockReturnValue(undefined);
      expect(detectRemoteUrl("/test")).toBeUndefined();
    });
  });

  describe("detectPrNumber", () => {
    it("returns PR number when gh finds one", () => {
      prNumberOr.mockReturnValue(42);
      expect(detectPrNumber("/test")).toBe(42);
    });

    it("returns undefined when gh is missing or no PR exists", () => {
      prNumberOr.mockReturnValue(undefined);
      expect(detectPrNumber("/test")).toBeUndefined();
    });
  });

  describe("gatherGitInfo", () => {
    it("returns undefined when not a git repo", () => {
      currentBranchOr.mockReturnValue(undefined);
      expect(gatherGitInfo("/test")).toBeUndefined();
    });

    it("returns GitInfo for a repo with branch + remote + PR", () => {
      currentBranchOr.mockReturnValue("feature/x");
      remoteUrlOr.mockReturnValue("git@github.com:org/repo.git");
      prNumberOr.mockReturnValue(123);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("feature/x");
      expect(info?.gitPrNumber).toBe(123);
      // Branch URLs URL-encode slashes (feature/x → feature%2Fx) in some builders
      expect(info?.gitBranchUrl).toMatch(/feature(\/|%2F)x/);
      expect(info?.gitPrUrl).toContain("123");
    });

    it("returns GitInfo without links when there's no remote", () => {
      currentBranchOr.mockReturnValue("main");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("main");
      expect(info?.gitBranchUrl).toBeUndefined();
    });

    it("handles detached HEAD with short SHA", () => {
      currentBranchOr.mockReturnValue("HEAD");
      headShaOr.mockReturnValue("abc1234");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("abc1234");
    });
  });

  describe("detectWorktree", () => {
    it("returns undefined when commonDir rev-parse fails", () => {
      commonDirOr.mockReturnValue(undefined);
      toplevelOr.mockReturnValue("/repo");
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("returns undefined when toplevel rev-parse fails", () => {
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue(undefined);
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("returns undefined for main checkout (absolute commonDir inside toplevel)", () => {
      // cwd is the main repo; commonDir lives at /repo/.git, toplevel == /repo.
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue("/repo");
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("returns undefined for main checkout (relative commonDir '.git')", () => {
      // Some git versions emit a relative `.git` when run from the main repo root.
      commonDirOr.mockReturnValue(".git");
      toplevelOr.mockReturnValue("/repo");
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("detects worktree (commonDir points back at main repo's .git)", () => {
      // cwd is /repo/.worktrees/feat-x; commonDir is the MAIN repo's .git.
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue("/repo/.worktrees/feat-x");
      const wt = detectWorktree("/repo/.worktrees/feat-x");
      expect(wt).toEqual({ mainPath: "/repo", name: "feat-x" });
    });

    it("detects worktree at a sibling path (man-page example layout)", () => {
      commonDirOr.mockReturnValue("/projects/myrepo/.git");
      toplevelOr.mockReturnValue("/projects/myrepo-feat-x");
      expect(detectWorktree("/projects/myrepo-feat-x")).toEqual({
        mainPath: "/projects/myrepo",
        name: "myrepo-feat-x",
      });
    });

    it("does NOT falsely flag a nested cwd inside main checkout as worktree", () => {
      // User runs from /repo/src; toplevel is /repo, commonDir is /repo/.git.
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue("/repo");
      expect(detectWorktree("/repo/src")).toBeUndefined();
    });
  });

  describe("gatherGitInfo + worktree integration", () => {
    it("populates gitWorktree when cwd is a worktree", () => {
      currentBranchOr.mockReturnValue("feat/x");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue("/repo/.worktrees/feat-x");

      const info = gatherGitInfo("/repo/.worktrees/feat-x");
      expect(info?.gitBranch).toBe("feat/x");
      expect(info?.gitWorktree).toEqual({ mainPath: "/repo", name: "feat-x" });
    });

    it("omits gitWorktree when cwd is the main checkout", () => {
      currentBranchOr.mockReturnValue("develop");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);
      commonDirOr.mockReturnValue("/repo/.git");
      toplevelOr.mockReturnValue("/repo");

      const info = gatherGitInfo("/repo");
      expect(info?.gitWorktree).toBeUndefined();
    });

    it("gitWorktree is undefined when rev-parse pair fails, but branch info still flows", () => {
      currentBranchOr.mockReturnValue("main");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);
      commonDirOr.mockReturnValue(undefined);
      toplevelOr.mockReturnValue(undefined);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("main");
      expect(info?.gitWorktree).toBeUndefined();
    });
  });
});
