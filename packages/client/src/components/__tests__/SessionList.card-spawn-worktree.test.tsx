/**
 * Routing test for the per-card `+Worktree` button (session-card-plus-session-button).
 *
 * The SessionCard `+Worktree` button is wired in SessionList to reuse the
 * existing WorktreeSpawnDialog via two paths:
 *   - session has attachedProposal → proposal-aware dialog (branch prefilled
 *     `os/<change>` + attachProposal carry-through).
 *   - session has no proposal → plain dialog (branch empty).
 *
 * Mirrors the harness in SessionList.worktree-per-change.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const { fetchGitHead, fetchWorktrees, fetchBranches, createWorktree } = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchGitHead, fetchWorktrees, fetchBranches, createWorktree };
});
vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(),
}));

import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  // matches:false → desktop layout, so the card renders the desktop branch
  // that carries the +Worktree button.
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
    gitBranch: "main",
    ...over,
  };
}

function renderList(session: DashboardSession, gitWorktreeEnabled = true) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList
          sessions={[session]}
          onSelect={() => {}}
          onSpawnSession={vi.fn()}
          gitWorktreeEnabled={gitWorktreeEnabled}
        />
      </ThemeProvider>
    </TestRouter>,
  );
}

describe("SessionList — card +Worktree routing (session-card-plus-session-button)", () => {
  it("8.3 click with attachedProposal opens proposal-aware dialog (branch os/<change>)", async () => {
    renderList(makeSession({ attachedProposal: "add-dark-mode" }));
    fireEvent.click(screen.getByTestId("session-card-spawn-worktree"));
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const branchInput = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(branchInput.value).toBe("os/add-dark-mode");
  });

  // Plain +Worktree (no proposal) now defaults to checkout mode: no
  // new-branch input rendered. See change: worktree-checkout-existing-branch.
  it("8.3 click without proposal opens plain dialog in checkout mode (no new-branch input)", async () => {
    renderList(makeSession({ attachedProposal: undefined }));
    fireEvent.click(screen.getByTestId("session-card-spawn-worktree"));
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect(screen.queryByTestId("worktree-new-branch-input")).toBeNull();
  });

  it("8.3 empty-string proposal still opens plain dialog in checkout mode (no new-branch input)", async () => {
    renderList(makeSession({ attachedProposal: "" }));
    fireEvent.click(screen.getByTestId("session-card-spawn-worktree"));
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect(screen.queryByTestId("worktree-new-branch-input")).toBeNull();
  });

  it("8.x card +Worktree button hidden when gitWorktreeEnabled=false", () => {
    renderList(makeSession(), false);
    expect(screen.queryByTestId("session-card-spawn-worktree")).toBeNull();
  });
});

describe("SessionList — +Worktree isGitRepo gate (gate-session-worktree-button-on-git)", () => {
  // Card button (`session-card-spawn-worktree`).
  it("card +Worktree ABSENT when isGitRepo === false (confirmed non-git)", () => {
    renderList(makeSession({ isGitRepo: false }));
    expect(screen.queryByTestId("session-card-spawn-worktree")).toBeNull();
  });

  it("card +Worktree PRESENT when isGitRepo === true", () => {
    renderList(makeSession({ isGitRepo: true }));
    expect(screen.getByTestId("session-card-spawn-worktree")).toBeTruthy();
  });

  it("card +Worktree PRESENT when isGitRepo === undefined (unknown / legacy — no regression)", () => {
    renderList(makeSession({ isGitRepo: undefined }));
    expect(screen.getByTestId("session-card-spawn-worktree")).toBeTruthy();
  });

  // Folder-header button (`folder-spawn-worktree-btn`).
  it("folder-header +Worktree ABSENT when the only session is isGitRepo === false", () => {
    renderList(makeSession({ isGitRepo: false }));
    expect(screen.queryByTestId("folder-spawn-worktree-btn")).toBeNull();
  });

  it("folder-header +Worktree PRESENT when isGitRepo === true", () => {
    renderList(makeSession({ isGitRepo: true }));
    expect(screen.getByTestId("folder-spawn-worktree-btn")).toBeTruthy();
  });

  it("folder-header +Worktree PRESENT when isGitRepo === undefined (unknown / legacy — no regression)", () => {
    renderList(makeSession({ isGitRepo: undefined }));
    expect(screen.getByTestId("folder-spawn-worktree-btn")).toBeTruthy();
  });
});
