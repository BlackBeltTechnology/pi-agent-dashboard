/**
 * Tests for vcs-info.ts (git half — jj half is covered separately).
 *
 * The file delegates to `@blackbelt-technology/pi-dashboard-shared/platform/git.js`
 * (the Recipe-based tool module). We mock that module so the tests focus
 * on the orchestration logic (branch detection, detached HEAD fallback,
 * PR detection) without spawning git.
 *
 * See changes: platform-command-executor, add-jj-workspace-plugin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { currentBranchOr, headShaOr, remoteUrlOr, prNumberOr } = vi.hoisted(() => ({
  currentBranchOr: vi.fn(),
  headShaOr: vi.fn(),
  remoteUrlOr: vi.fn(),
  prNumberOr: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", () => ({
  currentBranchOr,
  headShaOr,
  remoteUrlOr,
  prNumberOr,
}));

import { gatherGitInfo, detectBranch, detectRemoteUrl, detectPrNumber } from "../vcs-info.js";

describe("git-info", () => {
  beforeEach(() => {
    currentBranchOr.mockReset();
    headShaOr.mockReset();
    remoteUrlOr.mockReset();
    prNumberOr.mockReset();
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
});
