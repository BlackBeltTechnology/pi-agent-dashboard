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
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  createHeadBranchReader,
  detectBranch,
  detectIsGitRepo,
  detectRemoteUrl,
  detectWorktree,
  gatherGitInfo,
  GitFactsCache,
  type StaticGitFacts,
  worktreeFromRoots,
} from "../vcs-info.js";

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

  describe("gatherGitInfo", () => {
    it("returns undefined when not a git repo", () => {
      currentBranchOr.mockReturnValue(undefined);
      expect(gatherGitInfo("/test")).toBeUndefined();
    });

    it("returns GitInfo for a repo with branch + remote and NO PR fields (PR is probed async)", () => {
      currentBranchOr.mockReturnValue("feature/x");
      remoteUrlOr.mockReturnValue("git@github.com:org/repo.git");

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("feature/x");
      // Branch URLs URL-encode slashes (feature/x → feature%2Fx) in some builders
      expect(info?.gitBranchUrl).toMatch(/feature(\/|%2F)x/);
      expect(info).not.toHaveProperty("gitPrNumber");
      expect(info).not.toHaveProperty("gitPrUrl");
      // No synchronous `gh` on the tick path. See change: redesign-composer-session-strip.
      expect(prNumberOr).not.toHaveBeenCalled();
    });

    it("returns GitInfo without links when there's no remote", () => {
      currentBranchOr.mockReturnValue("main");
      remoteUrlOr.mockReturnValue(undefined);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("main");
      expect(info?.gitBranchUrl).toBeUndefined();
    });

    it("handles detached HEAD with short SHA", () => {
      currentBranchOr.mockReturnValue("HEAD");
      headShaOr.mockReturnValue("abc1234");
      remoteUrlOr.mockReturnValue(undefined);

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

    it("returns undefined for a linked worktree with NO thisCheckout (toplevel probe failed)", () => {
      // A linked worktree always HAS a working tree, so a null `thisCheckout`
      // means the probe failed. Falling back to `basename(cwd)` would mislabel a
      // session running in a subdirectory — exactly the case we cannot verify.
      checkoutRoots.mockReturnValue(
        roots({ thisCheckout: null, isLinkedWorktree: true, mainCheckout: "/repo" }),
      );
      expect(detectWorktree("/repo/.worktrees/feat-x/src/deep")).toBeUndefined();
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
      checkoutRoots.mockReturnValue({ thisCheckout: "/repo", isLinkedWorktree: false, mainCheckout: "/repo" });

      const info = gatherGitInfo("/repo");
      expect(info?.gitWorktree).toBeUndefined();
    });

    // X6 — a rev-parse failure must not take the rest of the poll tick with it.
    it("X6: gitWorktree is undefined when rev-parse fails, but branch/remote still flow", () => {
      currentBranchOr.mockReturnValue("main");
      remoteUrlOr.mockReturnValue("git@github.com:o/r.git");
      checkoutRoots.mockReturnValue(null);

      const info = gatherGitInfo("/test");
      expect(info?.gitBranch).toBe("main");
      expect(info?.gitBranchUrl).toBeDefined();
      expect(info?.gitWorktree).toBeUndefined();
    });
  });
});

// ── optimize-polling-hot-paths: HEAD-file branch + static facts cache ─────────

describe("createHeadBranchReader (D5)", () => {
  const deps = (files: Record<string, string | Error>, fallback = vi.fn(async () => "abc1234")) => ({
    readFile: (p: string) => {
      const v = files[p];
      if (v === undefined || v instanceof Error) throw v ?? Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    },
    mtimeOf: () => 7,
    fallback,
  });

  it("E15: symref HEAD (CRLF) → branch with zero spawns", () => {
    const fallback = vi.fn(async () => "x");
    const r = createHeadBranchReader(() => {}, deps({ "/g/HEAD": "ref: refs/heads/feature/x\r\n" }, fallback));
    expect(r.read("/c", "/g")).toBe("feature/x");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("E16: detached HEAD → async fallback once per HEAD content; previous value kept meanwhile", async () => {
    const fallback = vi.fn(async () => "abc1234");
    const onResolved = vi.fn();
    const r = createHeadBranchReader(onResolved, deps({ "/g/HEAD": "0123456789abcdef0123456789abcdef01234567\n" }, fallback));
    expect(r.read("/c", "/g")).toBeUndefined(); // pending
    expect(r.read("/c", "/g")).toBeUndefined(); // still one fallback
    expect(fallback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(r.read("/c", "/g")).toBe("abc1234");
    expect(fallback).toHaveBeenCalledTimes(1); // memoised
  });

  it("E17: non-heads ref and unreadable HEAD use the fallback, once for the ENOENT pair, no throw", async () => {
    const fallback = vi.fn(async () => "main");
    const a = createHeadBranchReader(() => {}, deps({ "/g/HEAD": "ref: refs/remotes/origin/main" }, fallback));
    a.read("/c", "/g");
    expect(fallback).toHaveBeenCalledTimes(1);
    const fb2 = vi.fn(async () => "main");
    const b = createHeadBranchReader(() => {}, deps({}, fb2));
    expect(() => b.read("/c", "/g")).not.toThrow();
    b.read("/c", "/g");
    expect(fb2).toHaveBeenCalledTimes(1);
  });

  it("reset forgets the previous value", () => {
    const r = createHeadBranchReader(() => {}, deps({ "/g/HEAD": "ref: refs/heads/a" }));
    expect(r.read("/c", "/g")).toBe("a");
    r.reset();
    const r2 = createHeadBranchReader(() => {}, deps({ "/g/HEAD": "garbage" }));
    expect(r2.read("/c", "/g")).toBeUndefined();
  });
});

describe("GitFactsCache (D4)", () => {
  const facts = (over: Partial<StaticGitFacts> = {}): StaticGitFacts => ({
    remoteUrl: "git@github.com:o/r.git",
    roots: null,
    gitDir: "/r/.git",
    dotGitStamp: "s1",
    ...over,
  });

  it("E18/E23: stable stamp → no probe between ticks; remote cached; async re-probe only on demand", async () => {
    const evaluate = vi.fn(() => facts());
    const evaluateAsync = vi.fn(async () => facts());
    const c = new GitFactsCache({ evaluate, evaluateAsync, stamp: () => "s1" });
    c.evaluate("/r");
    for (let i = 0; i < 9; i++) expect(c.stampChanged("/r")).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluateAsync).not.toHaveBeenCalled();
    const out = await c.reprobe("/r");
    expect(out.changed).toBe(false);
    expect(evaluateAsync).toHaveBeenCalledTimes(1);
  });

  it("E19: a stamp change is detected without spawning; re-probe reports the changed worktree", async () => {
    let stamp = "s1";
    const wtRoots = { thisCheckout: "/r/.worktrees/wt", isLinkedWorktree: true, mainCheckout: "/r", commonDir: "/r/.git", gitDir: "/r/.git/worktrees/wt" };
    const evaluateAsync = vi.fn(async () => facts({ roots: wtRoots as any, dotGitStamp: "s2" }));
    const c = new GitFactsCache({ evaluate: () => facts(), evaluateAsync, stamp: () => stamp });
    c.evaluate("/r/.worktrees/wt");
    stamp = "s2";
    expect(c.stampChanged("/r/.worktrees/wt")).toBe(true);
    const out = await c.reprobe("/r/.worktrees/wt");
    expect(out.changed).toBe(true);
    expect(worktreeFromRoots(out.facts.roots)).toEqual({ mainPath: "/r", name: "wt" });
  });

  it("E20: `git init` in a plain cwd — roots null → repo is a change", async () => {
    const c = new GitFactsCache({
      evaluate: () => facts({ roots: null, gitDir: undefined, dotGitStamp: "none:-" }),
      evaluateAsync: async () => facts({ roots: { thisCheckout: "/p", isLinkedWorktree: false, mainCheckout: "/p", commonDir: "/p/.git", gitDir: "/p/.git" } as any }),
      stamp: () => "none:d1",
    });
    c.evaluate("/p");
    expect(c.stampChanged("/p")).toBe(true);
    expect((await c.reprobe("/p")).changed).toBe(true);
  });

  it("E22: worktree name is the basename of the worktree ROOT, not the cwd subdirectory", () => {
    const roots = { thisCheckout: "/r/.worktrees/os-x", isLinkedWorktree: true, mainCheckout: "/r", commonDir: "/r/.git" };
    expect(worktreeFromRoots(roots as any)).toEqual({ mainPath: "/r", name: "os-x" });
  });

  it("B3: reprobe commits only when accept() still holds after the await", async () => {
    const OLD = facts({ remoteUrl: "git@old:o/r.git" });
    const NEW = facts({ remoteUrl: "git@new:o/r.git" });
    let release!: (f: StaticGitFacts) => void;
    const c = new GitFactsCache({
      evaluate: () => NEW,
      evaluateAsync: () => new Promise<StaticGitFacts>((r) => (release = r)),
      stamp: () => "s1",
    });
    c.evaluate("/r"); // NEW installed
    let current = true;
    const p = c.reprobe("/r", () => current);
    current = false; // a newer evaluation took over while the probe was in flight
    release(OLD);
    const out = await p;
    expect(out.committed).toBe(false);
    expect(c.get("/r")?.remoteUrl).toBe("git@new:o/r.git");
  });
});
