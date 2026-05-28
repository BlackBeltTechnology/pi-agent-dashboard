/**
 * Integration test for the per-change `⑂+` worktree-spawn button in
 * `FolderOpenSpecSection`, wired through `SessionList` to
 * `WorktreeSpawnDialog`.
 *
 * Flow under test:
 *   1. Folder is a git repo (`s.gitBranch` set) → ⑂+ visible per change.
 *   2. Click ⑂+ → `WorktreeSpawnDialog` opens with `os/<name>` prefill +
 *      `attachProposal=<name>`.
 *   3. Submit → `createWorktree` called → `onSpawnSession` invoked with
 *      `(path, <changeName>, { gitWorktreeBase, attachProposal })`.
 *
 * See change: openspec-worktree-spawn-button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

// Stub git-api so the dialog's parallel fetches resolve deterministically.
const { fetchGitHead, fetchWorktrees, fetchBranches, createWorktree } = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
}));
vi.mock("../../lib/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git-api.js")>("../../lib/git-api.js");
  return { ...actual, fetchGitHead, fetchWorktrees, fetchBranches, createWorktree };
});

// Stub openspec groups so the section renders without network.
vi.mock("../../lib/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(),
}));

import { SessionList } from "../SessionList.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  // Default git-api mocks
  fetchGitHead.mockResolvedValue({ branch: "main", detached: false, sha: "abc1234" });
  fetchWorktrees.mockResolvedValue([{ path: "/project/foo", branch: "main", isMain: true, detached: false, bare: false, sha: "" }]);
  fetchBranches.mockResolvedValue({
    current: "main",
    detached: false,
    branches: [{ name: "main", isRemote: false, isCurrent: true }],
  });
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    gitBranch: "main", // makes isGitRepo===true in SessionList
    ...over,
  };
}

const openspecData: OpenSpecData = {
  initialized: true,
  changes: [
    {
      name: "add-dark-mode",
      status: "in-progress",
      completedTasks: 1,
      totalTasks: 4,
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "ready" },
        { id: "specs", status: "blocked" },
        { id: "tasks", status: "blocked" },
      ],
    },
  ],
};

describe("SessionList — per-change ⑂+ worktree spawn end-to-end", () => {
  it("click ⑂+ → dialog opens prefilled → submit → onSpawnSession with attachProposal + gitWorktreeBase", async () => {
    const onSpawnSession = vi.fn();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/project/foo/.worktrees/os-add-dark-mode",
      branch: "os/add-dark-mode",
      excludeAppended: true,
    });

    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={onSpawnSession}
            openspecMap={new Map([["/project/foo", openspecData]])}
            gitWorktreeEnabled={true}
          />
        </ThemeProvider>
      </TestRouter>,
    );

    // Expand the OpenSpec section to surface the change row.
    fireEvent.click(screen.getByTestId("folder-openspec-header"));

    // ⑂+ button should be visible for the change row.
    const btn = screen.getByTestId("spawn-attached-worktree-btn-add-dark-mode");
    fireEvent.click(btn);

    // Dialog opens — wait for fetches to resolve.
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));

    // Branch input prefilled with `os/<change-name>`.
    const branchInput = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(branchInput.value).toBe("os/add-dark-mode");

    // Submit. Spawn callback should fire with attachProposal + gitWorktreeBase.
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));

    await waitFor(() => expect(onSpawnSession).toHaveBeenCalled());
    expect(onSpawnSession).toHaveBeenCalledWith(
      "/project/foo/.worktrees/os-add-dark-mode",
      "add-dark-mode",
      { gitWorktreeBase: "main", attachProposal: "add-dark-mode" },
    );
  });

  it("⑂+ button hidden when gitWorktreeEnabled=false", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession()]}
            onSelect={() => {}}
            onSpawnSession={vi.fn()}
            openspecMap={new Map([["/project/foo", openspecData]])}
            gitWorktreeEnabled={false}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-worktree-btn-add-dark-mode")).toBeNull();
    // Folder +Worktree button also hidden.
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
  });

  it("⑂+ button hidden on non-git folder even with flag on", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession({ gitBranch: undefined })]}
            onSelect={() => {}}
            onSpawnSession={vi.fn()}
            openspecMap={new Map([["/project/foo", openspecData]])}
            gitWorktreeEnabled={true}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-worktree-btn-add-dark-mode")).toBeNull();
  });
});
