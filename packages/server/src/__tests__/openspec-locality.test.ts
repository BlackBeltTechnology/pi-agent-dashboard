/**
 * Tri-state locality resolution for the OpenSpec auto-attach gate.
 * Scenario ids reference
 * `openspec/changes/scope-openspec-auto-attach-to-session-cwd/test-plan.md`.
 */
import { describe, expect, it, vi } from "vitest";
import {
  attachedStillExistsInCandidateRoots,
  candidateRoots,
  localityGateAllows,
  resolveChangeLocality,
  type LocalitySession,
  type OpenSpecCacheReader,
} from "../session/openspec-locality.js";

type CacheShape = Record<string, { initialized?: boolean; changes?: Array<{ name: string }> } | undefined>;

function cacheOf(map: CacheShape): OpenSpecCacheReader {
  return { getOpenSpecData: (cwd: string) => map[cwd] };
}

function initialized(...names: string[]) {
  return { initialized: true, changes: names.map((name) => ({ name })) };
}

/** Baseline: a plain, worktree-resolved, non-worktree session in /repo-a. */
function session(overrides: Partial<LocalitySession> = {}): LocalitySession {
  return { cwd: "/repo-a", gitWorktreeReported: true, ...overrides } as LocalitySession;
}

describe("resolveChangeLocality — tri-state (D6)", () => {
  it("E5 unknown when the only candidate root has no cached data", () => {
    const cache = cacheOf({});
    expect(resolveChangeLocality(cache, session(), "c-a")).toBe("unknown");
    expect(localityGateAllows(cache, session(), "c-a")).toBe(true);
  });

  it("E6 unknown root dominates: cwd initialized without the name, mainPath uninitialized", () => {
    const cache = cacheOf({ "/repo-a/.worktrees/os-c-a": initialized("other") });
    const s = session({
      cwd: "/repo-a/.worktrees/os-c-a",
      gitWorktree: { mainPath: "/repo-a" } as any,
    });
    expect(resolveChangeLocality(cache, s, "c-a")).toBe("unknown");
    expect(localityGateAllows(cache, s, "c-a")).toBe(true);
  });

  it("E7 rejects when every candidate root is initialized and none lists the name", () => {
    const cache = cacheOf({
      "/repo-a/.worktrees/os-c-a": initialized("other"),
      "/repo-a": initialized("something-else"),
    });
    const s = session({
      cwd: "/repo-a/.worktrees/os-c-a",
      gitWorktree: { mainPath: "/repo-a" } as any,
    });
    expect(resolveChangeLocality(cache, s, "c-a")).toBe("absent");
    expect(localityGateAllows(cache, s, "c-a")).toBe(false);
  });

  it("E3 a worktree change present only in the main checkout is allowed", () => {
    const cache = cacheOf({
      "/repo-a/.worktrees/os-c-a": initialized(),
      "/repo-a": initialized("c-a"),
    });
    const s = session({
      cwd: "/repo-a/.worktrees/os-c-a",
      gitWorktree: { mainPath: "/repo-a" } as any,
    });
    expect(resolveChangeLocality(cache, s, "c-a")).toBe("present");
  });

  it("E1/E2 a reported non-worktree session resolves over its cwd alone", () => {
    const cache = cacheOf({ "/repo-a": initialized("c-a") });
    expect(localityGateAllows(cache, session(), "c-b")).toBe(false);
    expect(localityGateAllows(cache, session(), "c-a")).toBe(true);
  });

  it("P1 one evaluation performs cache reads only — never a fresh poll", () => {
    const getOpenSpecData = vi.fn(() => initialized("c-a"));
    const refreshOpenSpec = vi.fn();
    const pollDirectoryGated = vi.fn();
    const svc = { getOpenSpecData, refreshOpenSpec, pollDirectoryGated } as unknown as OpenSpecCacheReader;
    localityGateAllows(svc, session(), "c-b");
    expect(getOpenSpecData).toHaveBeenCalled();
    expect(refreshOpenSpec).not.toHaveBeenCalled();
    expect(pollDirectoryGated).not.toHaveBeenCalled();
  });
});

describe("candidate roots + worktree resolution (D8)", () => {
  it("E8 unreported session with unknown isGitRepo adds an unknown root → allow", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    const s = session({ gitWorktreeReported: undefined, isGitRepo: undefined });
    expect(candidateRoots(s)).toEqual({ roots: ["/repo-a"], hasUnknownRoot: true });
    expect(localityGateAllows(cache, s, "c-a")).toBe(true);
  });

  it("X7 no worktree report ever + isGitRepo undefined → never falsely rejected", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    const s = session({ gitWorktreeReported: undefined, isGitRepo: undefined });
    expect(resolveChangeLocality(cache, s, "c-a")).toBe("unknown");
  });

  it("E9 a reported non-worktree session is reject-capable", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    const s = session({ gitWorktreeReported: true, isGitRepo: true });
    expect(candidateRoots(s).hasUnknownRoot).toBe(false);
    expect(localityGateAllows(cache, s, "c-a")).toBe(false);
  });

  it("E10 isGitRepo === false resolves the session without any bridge report", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    const s = session({ gitWorktreeReported: undefined, isGitRepo: false });
    expect(candidateRoots(s).hasUnknownRoot).toBe(false);
    expect(localityGateAllows(cache, s, "c-a")).toBe(false);
  });

  it("E11 restored mainPath contributes a root AND an unknown root is added → allow", () => {
    const cache = cacheOf({
      "/repo-a/.worktrees/os-c-a": initialized("other"),
      "/repo-a": initialized("something-else"),
    });
    const s = session({
      cwd: "/repo-a/.worktrees/os-c-a",
      gitWorktree: { mainPath: "/repo-a" } as any,
      gitWorktreeReported: undefined,
      isGitRepo: undefined,
    });
    expect(candidateRoots(s)).toEqual({
      roots: ["/repo-a/.worktrees/os-c-a", "/repo-a"],
      hasUnknownRoot: true,
    });
    expect(localityGateAllows(cache, s, "c-a")).toBe(true);
  });
});

describe("deleted-proposal bypass predicate (D9)", () => {
  it("fails OPEN on an unknown cache — preserving today's semantics", () => {
    expect(attachedStillExistsInCandidateRoots(cacheOf({}), session(), "A")).toBe(true);
  });

  it("consults the worktree main path, so a main-only change is not read as deleted", () => {
    const cache = cacheOf({
      "/repo-a/.worktrees/os-c-a": initialized(),
      "/repo-a": initialized("c-a"),
    });
    const s = session({
      cwd: "/repo-a/.worktrees/os-c-a",
      gitWorktree: { mainPath: "/repo-a" } as any,
    });
    expect(attachedStillExistsInCandidateRoots(cache, s, "c-a")).toBe(true);
  });

  it("ignores the gate's UNKNOWN root, so branch 4 still fires for an unreported session", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    const s = session({ gitWorktreeReported: undefined, isGitRepo: undefined });
    // The gate allows (unknown root dominates) …
    expect(localityGateAllows(cache, s, "c-a")).toBe(true);
    // … but the bypass must NOT inherit that unknown root, otherwise a
    // genuinely archived attachment would raise a replace dialog the existing
    // contract forbids.
    expect(attachedStillExistsInCandidateRoots(cache, s, "A")).toBe(false);
  });

  it("still reports a genuinely archived change as deleted", () => {
    const cache = cacheOf({ "/repo-a": initialized("other") });
    expect(attachedStillExistsInCandidateRoots(cache, session(), "A")).toBe(false);
  });
});
