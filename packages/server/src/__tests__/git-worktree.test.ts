/**
 * Unit tests for the §3 pure helpers in `git-worktree.ts`.
 *
 * Pins:
 *  - slug rule (case-fold, separator collapse, char strip, edge-trim, length cap)
 *  - porcelain parser arms (main + worktree + detached + bare + locked-tolerated)
 *  - base fallback chain (current → develop → main → master → no_usable_base)
 *  - exclude-line idempotency + boundary conditions
 *
 * See change: add-worktree-spawn-dialog.
 */
import { describe, it, expect } from "vitest";
import {
  slugifyBranch,
  localNameOf,
  resolveCheckoutLocalName,
  parsePorcelainWorktrees,
  resolveDefaultBase,
  ensureWorktreeExcludeLine,
  isOrphanWorktreePath,
  isSameWorktreePath,
} from "../git-worktree/git-worktree.js";

describe("localNameOf", () => {
  it("strips a remote prefix", () => {
    expect(localNameOf("origin/foo")).toBe("foo");
    expect(localNameOf("upstream/feature")).toBe("feature");
  });
  it("returns a bare local name unchanged", () => {
    expect(localNameOf("foo")).toBe("foo");
  });
});

describe("resolveCheckoutLocalName", () => {
  it("strips a remote prefix when base is NOT a local branch", () => {
    expect(resolveCheckoutLocalName("origin/foo", false)).toBe("foo");
  });
  it("keeps a local branch name with a slash intact (regression: openspec/...)", () => {
    // localNameOf alone would wrongly yield "inline-raw-html-image-tags",
    // diverging from the server's `.worktrees/openspec-...` target.
    expect(
      resolveCheckoutLocalName("openspec/inline-raw-html-image-tags", true),
    ).toBe("openspec/inline-raw-html-image-tags");
  });
  it("leaves a bare local name unchanged in both modes", () => {
    expect(resolveCheckoutLocalName("foo", true)).toBe("foo");
    expect(resolveCheckoutLocalName("foo", false)).toBe("foo");
  });
});

describe("slugifyBranch", () => {
  it("lower-cases ASCII letters", () => {
    expect(slugifyBranch("Main")).toBe("main");
  });

  it("collapses slash / backslash / colon / whitespace runs to single dash", () => {
    expect(slugifyBranch("feat/dark-mode")).toBe("feat-dark-mode");
    expect(slugifyBranch("feat\\sub")).toBe("feat-sub");
    expect(slugifyBranch("ns:branch")).toBe("ns-branch");
    expect(slugifyBranch("two  spaces")).toBe("two-spaces");
    expect(slugifyBranch("mix / : \\ ws")).toBe("mix-ws");
  });

  it("strips characters outside [a-z0-9._-]", () => {
    expect(slugifyBranch("fix/issue #123")).toBe("fix-issue-123");
    expect(slugifyBranch("WIP: try a thing!")).toBe("wip-try-a-thing");
    expect(slugifyBranch("café-au-lait")).toBe("caf-au-lait");
  });

  it("preserves dots and underscores", () => {
    expect(slugifyBranch("release/2026.05_rc1")).toBe("release-2026.05_rc1");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyBranch("---hello---")).toBe("hello");
    expect(slugifyBranch("/leading")).toBe("leading");
    expect(slugifyBranch("trailing/")).toBe("trailing");
  });

  it("caps length at 64", () => {
    const long = "a".repeat(100);
    expect(slugifyBranch(long).length).toBe(64);
  });

  it("returns empty string when input is all-strippable", () => {
    expect(slugifyBranch("!!!")).toBe("");
    expect(slugifyBranch("   ")).toBe("");
    expect(slugifyBranch("")).toBe("");
  });

  it("feat/Dark Mode! → feat-dark-mode (spec example)", () => {
    expect(slugifyBranch("feat/Dark Mode!")).toBe("feat-dark-mode");
  });
});

describe("parsePorcelainWorktrees", () => {
  it("returns empty list for empty input", () => {
    expect(parsePorcelainWorktrees("")).toEqual([]);
  });

  it("parses a main-only repo (one worktree)", () => {
    const out = parsePorcelainWorktrees(
      `worktree /repo\nHEAD abc123\nbranch refs/heads/main\n`,
    );
    expect(out).toEqual([
      { path: "/repo", branch: "main", sha: "abc123", bare: false, detached: false, isMain: true },
    ]);
  });

  it("parses main + two worktrees, flags isMain only on first", () => {
    const out = parsePorcelainWorktrees([
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/develop",
      "",
      "worktree /repo/.worktrees/feat-x",
      "HEAD bbb",
      "branch refs/heads/feat/x",
      "",
      "worktree /repo/.worktrees/fix-42",
      "HEAD ccc",
      "branch refs/heads/fix/42",
    ].join("\n"));
    expect(out).toHaveLength(3);
    expect(out[0]?.isMain).toBe(true);
    expect(out[0]?.branch).toBe("develop");
    expect(out[1]?.isMain).toBe(false);
    expect(out[1]?.branch).toBe("feat/x");
    expect(out[2]?.isMain).toBe(false);
    expect(out[2]?.branch).toBe("fix/42");
  });

  it("flags detached worktree with branch:null", () => {
    const out = parsePorcelainWorktrees([
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/detached",
      "HEAD bbb",
      "detached",
    ].join("\n"));
    expect(out[1]).toMatchObject({ detached: true, branch: null });
  });

  it("flags bare worktree with branch:null and bare:true", () => {
    const out = parsePorcelainWorktrees([
      "worktree /repo/.bare",
      "bare",
      "",
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
    ].join("\n"));
    expect(out[0]).toMatchObject({ bare: true, branch: null, isMain: true });
    expect(out[1]).toMatchObject({ bare: false, branch: "main" });
  });

  it("tolerates unknown lines (locked / prunable / etc.)", () => {
    const out = parsePorcelainWorktrees([
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/locked",
      "HEAD bbb",
      "branch refs/heads/feat",
      "locked because work in progress",
      "prunable",
    ].join("\n"));
    expect(out).toHaveLength(2);
    expect(out[1]?.branch).toBe("feat");
  });

  it("handles CRLF line endings", () => {
    const out = parsePorcelainWorktrees(
      "worktree /repo\r\nHEAD aaa\r\nbranch refs/heads/main\r\n\r\nworktree /b\r\nHEAD bbb\r\ndetached\r\n",
    );
    expect(out).toHaveLength(2);
    expect(out[1]?.detached).toBe(true);
  });

  it("ignores records without a worktree line", () => {
    const out = parsePorcelainWorktrees("\n\nHEAD orphan\n\n");
    expect(out).toEqual([]);
  });
});

describe("resolveDefaultBase", () => {
  it("picks current branch when attached and exists locally", () => {
    expect(resolveDefaultBase({
      currentBranch: "feature",
      localBranches: ["main", "feature"],
      remoteBranches: [],
    })).toEqual({ ok: true, base: "feature" });
  });

  it("falls through to develop when detached", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["develop", "main"],
      remoteBranches: [],
    })).toEqual({ ok: true, base: "develop" });
  });

  it("falls through to main when develop is missing", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["main"],
      remoteBranches: [],
    })).toEqual({ ok: true, base: "main" });
  });

  it("falls through to master when develop and main are missing", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["master"],
      remoteBranches: [],
    })).toEqual({ ok: true, base: "master" });
  });

  it("uses remote origin/develop when not present locally", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: [],
      remoteBranches: ["origin/develop", "origin/main"],
    })).toEqual({ ok: true, base: "origin/develop" });
  });

  it("prefers local develop over remote origin/main", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["develop"],
      remoteBranches: ["origin/main"],
    })).toEqual({ ok: true, base: "develop" });
  });

  it("prefers local develop over remote origin/develop", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["develop"],
      remoteBranches: ["origin/develop"],
    })).toEqual({ ok: true, base: "develop" });
  });

  it("returns no_usable_base when none of the four candidates exist", () => {
    expect(resolveDefaultBase({
      currentBranch: null,
      localBranches: ["some-other-branch"],
      remoteBranches: ["origin/feature"],
    })).toEqual({ ok: false, error: "no_usable_base" });
  });

  it("ignores currentBranch when it's a remote-only branch (would be detached worktree)", () => {
    // currentBranch coming from the PARENT repo is local-only by construction
    // (we never get "origin/x" as currentBranch). Belt-and-braces: even if
    // someone passed it, the local-set check makes us fall through.
    expect(resolveDefaultBase({
      currentBranch: "origin/feature",
      localBranches: ["develop"],
      remoteBranches: ["origin/feature"],
    })).toEqual({ ok: true, base: "develop" });
  });
});

describe("ensureWorktreeExcludeLine", () => {
  it("appends to empty content", () => {
    expect(ensureWorktreeExcludeLine("")).toEqual({
      content: ".worktrees/\n",
      appended: true,
    });
  });

  it("appends with a leading newline when existing lacks trailing newline", () => {
    expect(ensureWorktreeExcludeLine("foo")).toEqual({
      content: "foo\n.worktrees/\n",
      appended: true,
    });
  });

  it("appends without leading newline when existing already ends with one", () => {
    expect(ensureWorktreeExcludeLine("foo\n")).toEqual({
      content: "foo\n.worktrees/\n",
      appended: true,
    });
  });

  it("is a no-op when line is already present (idempotent)", () => {
    const existing = "foo\n.worktrees/\nbar\n";
    expect(ensureWorktreeExcludeLine(existing)).toEqual({
      content: existing,
      appended: false,
    });
  });

  it("is a no-op when line is the only line", () => {
    expect(ensureWorktreeExcludeLine(".worktrees/\n")).toEqual({
      content: ".worktrees/\n",
      appended: false,
    });
  });

  it("does NOT match `.worktrees` (no trailing slash) as a hit", () => {
    const existing = ".worktrees\n";
    const result = ensureWorktreeExcludeLine(existing);
    expect(result.appended).toBe(true);
    expect(result.content).toBe(".worktrees\n.worktrees/\n");
  });

  it("does NOT match `worktrees/` (no leading dot) as a hit", () => {
    const existing = "worktrees/\n";
    const result = ensureWorktreeExcludeLine(existing);
    expect(result.appended).toBe(true);
  });

  it("tolerates CRLF in existing content", () => {
    expect(ensureWorktreeExcludeLine("foo\r\n.worktrees/\r\n")).toEqual({
      content: "foo\r\n.worktrees/\r\n",
      appended: false,
    });
  });
});
describe("isSameWorktreePath", () => {
  it("identical paths match", () => {
    expect(isSameWorktreePath("/repo/.worktrees/a", "/repo/.worktrees/a")).toBe(true);
  });

  it("trailing slash normalized", () => {
    expect(isSameWorktreePath("/repo/.worktrees/a/", "/repo/.worktrees/a")).toBe(true);
  });

  it("backslash vs forward slash treated equal", () => {
    expect(isSameWorktreePath("C:\\repo\\wt", "C:/repo/wt")).toBe(true);
  });

  it("completely different paths do not match", () => {
    expect(isSameWorktreePath("/repo/a", "/repo/b")).toBe(false);
  });

  it("empty strings handled gracefully", () => {
    expect(isSameWorktreePath("", "")).toBe(true);
    expect(isSameWorktreePath("", "/repo/a")).toBe(false);
  });
});

describe("isOrphanWorktreePath", () => {
  it("returns true when path exists but is NOT in worktree list (orphan)", () => {
    expect(isOrphanWorktreePath({
      path: "/repo/.worktrees/orphan",
      worktreeList: [{ path: "/repo" }, { path: "/repo/.worktrees/wt-a" }],
      exists: () => true,
    })).toBe(true);
  });

  it("returns false when path matches a registered worktree", () => {
    expect(isOrphanWorktreePath({
      path: "/repo/.worktrees/wt-a",
      worktreeList: [{ path: "/repo" }, { path: "/repo/.worktrees/wt-a" }],
      exists: () => true,
    })).toBe(false);
  });

  it("returns false when path does NOT exist on disk", () => {
    expect(isOrphanWorktreePath({
      path: "/repo/.worktrees/missing",
      worktreeList: [{ path: "/repo" }],
      exists: () => false,
    })).toBe(false);
  });

  it("returns false on empty path argument", () => {
    expect(isOrphanWorktreePath({
      path: "",
      worktreeList: [],
      exists: () => true,
    })).toBe(false);
  });

  it("normalizes trailing slash when comparing against worktree list", () => {
    expect(isOrphanWorktreePath({
      path: "/repo/.worktrees/wt-a/",
      worktreeList: [{ path: "/repo/.worktrees/wt-a" }],
      exists: () => true,
    })).toBe(false);
  });

  it("empty worktree list with existing path always orphan", () => {
    expect(isOrphanWorktreePath({
      path: "/some/orphan",
      worktreeList: [],
      exists: () => true,
    })).toBe(true);
  });
});

