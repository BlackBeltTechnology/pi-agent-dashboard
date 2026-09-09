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

const { currentBranchOr, headShaOr, remoteUrlOr, prNumberOr, checkoutRoots, isGitRepo } = vi.hoisted(() => ({
  currentBranchOr: vi.fn(),
  headShaOr: vi.fn(),
  remoteUrlOr: vi.fn(),
  prNumberOr: vi.fn(),
  checkoutRoots: vi.fn(),
  isGitRepo: vi.fn(),
}));

// `hasGitPathSegment` is deliberately NOT stubbed: the consumer-side `.git`
// rejection is what these tests assert, so it must be the real implementation.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git.js")>()),
  currentBranchOr,
  headShaOr,
  remoteUrlOr,
  prNumberOr,
  checkoutRoots,
  isGitRepo,
}));

import { gatherGitInfo, detectBranch, detectRemoteUrl, detectPrNumber, detectWorktree, detectIsGitRepo } from "../vcs-info.js";

describe("git-info", () => {
  beforeEach(() => {
    currentBranchOr.mockReset();
    headShaOr.mockReset();
    remoteUrlOr.mockReset();
    prNumberOr.mockReset();
    checkoutRoots.mockReset();
    isGitRepo.mockReset();
  });

  describe("detectIsGitRepo", () => {
    it("returns true when git confirms a work tree", () => {
      isGitRepo.mockReturnValue({ ok: true, value: true });
      expect(detectIsGitRepo("/repo")).toBe(true);
    });

    it("returns false when git succeeds but reports not-a-work-tree", () => {
      isGitRepo.mockReturnValue({ ok: true, value: false });
      expect(detectIsGitRepo("/plain")).toBe(false);
    });

    it("returns false when git exits 128 (definitively not a repo)", () => {
      isGitRepo.mockReturnValue({
        ok: false,
        error: { kind: "exit", code: 128, signal: null, stdout: "", stderr: "not a git repository" },
      });
      expect(detectIsGitRepo("/plain")).toBe(false);
    });

    it("returns undefined when git binary is missing", () => {
      isGitRepo.mockReturnValue({ ok: false, error: { kind: "not-found", binary: "git" } });
      expect(detectIsGitRepo("/repo")).toBeUndefined();
    });

    it("returns undefined when the probe times out", () => {
      isGitRepo.mockReturnValue({ ok: false, error: { kind: "timeout", timeoutMs: 15000, binary: "git" } });
      expect(detectIsGitRepo("/slow-mount")).toBeUndefined();
    });

    it("returns undefined on a spawn failure", () => {
      isGitRepo.mockReturnValue({ ok: false, error: { kind: "spawn-failure", message: "boom" } });
      expect(detectIsGitRepo("/repo")).toBeUndefined();
    });

    it("returns undefined on a non-128 exit code (inconclusive, never false)", () => {
      isGitRepo.mockReturnValue({
        ok: false,
        error: { kind: "exit", code: 129, signal: null, stdout: "", stderr: "" },
      });
      expect(detectIsGitRepo("/repo")).toBeUndefined();
    });
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
    /** Shorthand for a resolver verdict. */
    const roots = (over: Partial<{ thisCheckout: string | null; isLinkedWorktree: boolean; mainCheckout: string | null }>) => ({
      thisCheckout: null,
      isLinkedWorktree: false,
      mainCheckout: null,
      ...over,
    });

    it("returns undefined when a required rev-parse fails (no result)", () => {
      checkoutRoots.mockReturnValue(null);
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("returns undefined when toplevel rev-parse fails (bare repo)", () => {
      checkoutRoots.mockReturnValue(roots({ isLinkedWorktree: false }));
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("returns undefined for main checkout (not a linked worktree)", () => {
      checkoutRoots.mockReturnValue(roots({ thisCheckout: "/repo", mainCheckout: "/repo" }));
      expect(detectWorktree("/repo")).toBeUndefined();
    });

    it("detects worktree (linked worktree with a resolved main checkout)", () => {
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: "/repo/.worktrees/feat-x", isLinkedWorktree: true, mainCheckout: "/repo" }),
      );
      expect(detectWorktree("/repo/.worktrees/feat-x")).toEqual({ mainPath: "/repo", name: "feat-x" });
    });

    it("detects worktree at a sibling path (man-page example layout)", () => {
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: "/projects/myrepo-feat-x", isLinkedWorktree: true, mainCheckout: "/projects/myrepo" }),
      );
      expect(detectWorktree("/projects/myrepo-feat-x")).toEqual({
        mainPath: "/projects/myrepo",
        name: "myrepo-feat-x",
      });
    });

    it("does NOT falsely flag a nested cwd inside main checkout as worktree", () => {
      checkoutRoots.mockReturnValue(roots({ thisCheckout: "/repo", mainCheckout: "/repo" }));
      expect(detectWorktree("/repo/src")).toBeUndefined();
    });

    it("does NOT report a submodule as a worktree (gitDir == commonDir)", () => {
      // The superseded "common dir outside toplevel" test called this a worktree
      // and emitted mainPath = <super>/.git/modules — a path that does not exist.
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: "/super/models/sub", mainCheckout: "/super/models/sub" }),
      );
      expect(detectWorktree("/super/models/sub")).toBeUndefined();
    });

    it("reports a worktree of a submodule against the submodule checkout", () => {
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: "/sub-wt", isLinkedWorktree: true, mainCheckout: "/super/models/sub" }),
      );
      expect(detectWorktree("/sub-wt")).toEqual({ mainPath: "/super/models/sub", name: "sub-wt" });
    });

    it("returns undefined for a worktree of a bare hub (no main checkout)", () => {
      checkoutRoots.mockReturnValue(roots({ thisCheckout: "/bare-wt", isLinkedWorktree: true, mainCheckout: null }));
      expect(detectWorktree("/bare-wt")).toBeUndefined();
    });

    // E18 — the resolver returns a user-controlled `core.worktree` verbatim, so
    // the consumer must reject it itself; it may not assume it was filtered.
    it("E18: rejects a resolved main checkout containing a .git segment", () => {
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: "/repo/.git/modules/bogus" }),
      );
      expect(detectWorktree("/wt")).toBeUndefined();
    });

    it("E11: does not reject a main checkout merely ending in .git", () => {
      checkoutRoots.mockReturnValue(roots({ thisCheckout: "/wt", isLinkedWorktree: true, mainCheckout: "/work/app.git" }));
      expect(detectWorktree("/wt")).toEqual({ mainPath: "/work/app.git", name: "wt" });
    });
  });

  describe("gatherGitInfo + worktree integration", () => {
    it("populates gitWorktree when cwd is a worktree", () => {
      currentBranchOr.mockReturnValue("feat/x");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);
      checkoutRoots.mockReturnValue({
        thisCheckout: "/repo/.worktrees/feat-x",
        isLinkedWorktree: true,
        mainCheckout: "/repo",
      });

      const info = gatherGitInfo("/repo/.worktrees/feat-x");
      expect(info?.gitBranch).toBe("feat/x");
      expect(info?.gitWorktree).toEqual({ mainPath: "/repo", name: "feat-x" });
    });

    it("omits gitWorktree when cwd is the main checkout", () => {
      currentBranchOr.mockReturnValue("develop");
      remoteUrlOr.mockReturnValue(undefined);
      prNumberOr.mockReturnValue(undefined);
      checkoutRoots.mockReturnValue({ thisCheckout: "/repo", isLinkedWorktree: false, mainCheckout: "/repo" });

      const info = gatherGitInfo("/repo");
      expect(info?.gitWorktree).toBeUndefined();
    });

    // X6 — a rev-parse failure must not take the rest of the poll tick with it.
    it("X6: gitWorktree is undefined when rev-parse fails, but branch/remote/PR still flow", () => {
      currentBranchOr.mockReturnValue("main");
      remoteUrlOr.mockReturnValue("git@github.com:o/r.git");
      prNumberOr.mockReturnValue(42);
      checkoutRoots.mockReturnValue(null);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("main");
      expect(info?.gitPrNumber).toBe(42);
      expect(info?.gitBranchUrl).toBeDefined();
      expect(info?.gitWorktree).toBeUndefined();
    });
  });
});
