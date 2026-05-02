/**
 * Truth-table tests for the jj-plugin slot predicates.
 *
 * Per spec scenario "Predicate-gated rendering when jj is not installed",
 * `isInJjRepo` and `isInJjWorkspace` must both return `false` whenever
 * `Session.jjState` is missing or marks the session as not-jj.
 *
 * See change: add-jj-workspace-plugin.
 */
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { isInJjRepo, isInJjWorkspace, isInGitRepoButNotJj } from "../client/predicates.js";

const baseSession: DashboardSession = {
  id: "s1",
  cwd: "/repo",
  source: "dashboard",
  status: "active",
  startedAt: 0,
};

describe("isInJjRepo", () => {
  it("false when session is null/undefined", () => {
    expect(isInJjRepo(null)).toBe(false);
    expect(isInJjRepo(undefined)).toBe(false);
  });

  it("false when jjState is absent", () => {
    expect(isInJjRepo(baseSession)).toBe(false);
  });

  it("false when jjState.isJjRepo is false", () => {
    expect(
      isInJjRepo({ ...baseSession, jjState: { isJjRepo: false, isColocated: false } }),
    ).toBe(false);
  });

  it("true when jjState.isJjRepo is true", () => {
    expect(
      isInJjRepo({ ...baseSession, jjState: { isJjRepo: true, isColocated: true } }),
    ).toBe(true);
  });
});

describe("isInJjWorkspace", () => {
  it("false when no workspace name", () => {
    expect(
      isInJjWorkspace({
        ...baseSession,
        jjState: { isJjRepo: true, isColocated: true },
      }),
    ).toBe(false);
  });

  it("true when isJjRepo + workspaceName", () => {
    expect(
      isInJjWorkspace({
        ...baseSession,
        jjState: { isJjRepo: true, isColocated: true, workspaceName: "default" },
      }),
    ).toBe(true);
  });

  it("false when isJjRepo is false even with a workspaceName (impossible state, defensive)", () => {
    expect(
      isInJjWorkspace({
        ...baseSession,
        jjState: { isJjRepo: false, isColocated: false, workspaceName: "ghost" },
      }),
    ).toBe(false);
  });
});

describe("isInGitRepoButNotJj", () => {
  it("false on null session", () => {
    expect(isInGitRepoButNotJj(null)).toBe(false);
  });

  it("false on no-git, no-jj session", () => {
    expect(isInGitRepoButNotJj(baseSession)).toBe(false);
  });

  it("true on git-only session (gitBranch present, no jjState)", () => {
    expect(
      isInGitRepoButNotJj({ ...baseSession, gitBranch: "develop" }),
    ).toBe(true);
  });

  it("false on jj-colocated session (gitBranch + jjState)", () => {
    expect(
      isInGitRepoButNotJj({
        ...baseSession,
        gitBranch: "develop",
        jjState: { isJjRepo: true, isColocated: true },
      }),
    ).toBe(false);
  });

  it("false when jjState.isJjRepo is false but jjState present (rare probe state)", () => {
    expect(
      isInGitRepoButNotJj({
        ...baseSession,
        gitBranch: "develop",
        // The bridge probe never sets isJjRepo:false on a real cwd —
        // it returns undefined instead — but defensive code path still works.
        jjState: { isJjRepo: false, isColocated: false },
      }),
    ).toBe(true);
  });
});
