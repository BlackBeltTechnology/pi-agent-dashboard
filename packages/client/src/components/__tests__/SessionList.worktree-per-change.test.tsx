/**
 * Per-change `New worktree` action on the OpenSpec board proposal card.
 *
 * The inline `⑂+` button moved from `FolderOpenSpecSection` to the board's
 * proposal-card action footer. This verifies the card action fires
 * `onSpawnAttachedWorktree(cwd, changeName)` and is gated by
 * `isGitRepo` / `gitWorktreeEnabled`. The full dialog→spawn e2e is covered by
 * `WorktreeSpawnDialog` tests (now wired at the App level for the board).
 *
 * See change: redesign-openspec-board.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// Stub openspec groups + config so the board renders without network.
vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {}, changeOrder: {} })),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(),
  setChangeOrder: vi.fn(),
}));
vi.mock("../../lib/openspec/openspec-config-api.js", () => ({
  useOpenSpecConfig: () => ({ profile: "custom", delivery: "both", workflows: [] }),
}));

import { OpenSpecBoardView } from "../openspec/OpenSpecBoardView.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })),
  });
});

const data: OpenSpecData = {
  initialized: true,
  changes: [
    { name: "add-dark-mode", status: "in-progress", completedTasks: 1, totalTasks: 4, artifacts: [{ id: "proposal", status: "done" }] },
  ],
};

function baseProps() {
  return {
    cwd: "/project/foo",
    data,
    sessions: [],
    openspecMap: new Map([["/project/foo", data]]),
    groupsState: { groups: [], assignments: {}, changeOrder: {} },
    onBack: vi.fn(),
    onRefresh: vi.fn(),
    onReadArtifact: vi.fn(),
    onNavigateToSession: vi.fn(),
    onOpenSpecs: vi.fn(),
    onOpenArchive: vi.fn(),
    onSpawnSession: vi.fn(),
    onSpawnAttachedWorktree: vi.fn(),
    onResumeSession: vi.fn(),
    onHideSession: vi.fn(),
    onUnhideSession: vi.fn(),
    onSendPrompt: vi.fn(),
    onAttachProposal: vi.fn(),
    onDetachProposal: vi.fn(),
    onBulkArchive: vi.fn(),
    isGitRepo: true,
    gitWorktreeEnabled: true,
  };
}

describe("OpenSpec board — per-change New worktree action", () => {
  it("New worktree action fires onSpawnAttachedWorktree with cwd + change name", () => {
    const props = baseProps();
    render(<OpenSpecBoardView {...props} />);
    fireEvent.click(screen.getByTestId("card-new-worktree-add-dark-mode"));
    expect(props.onSpawnAttachedWorktree).toHaveBeenCalledWith("/project/foo", "add-dark-mode");
  });

  it("New session action fires onSpawnSession with cwd + change name", () => {
    const props = baseProps();
    render(<OpenSpecBoardView {...props} />);
    fireEvent.click(screen.getByTestId("card-new-session-add-dark-mode"));
    expect(props.onSpawnSession).toHaveBeenCalledWith("/project/foo", "add-dark-mode");
  });

  it("New worktree action hidden when gitWorktreeEnabled=false", () => {
    render(<OpenSpecBoardView {...baseProps()} gitWorktreeEnabled={false} />);
    expect(screen.queryByTestId("card-new-worktree-add-dark-mode")).toBeNull();
  });

  it("New worktree action hidden on non-git folder even with flag on", () => {
    render(<OpenSpecBoardView {...baseProps()} isGitRepo={false} />);
    expect(screen.queryByTestId("card-new-worktree-add-dark-mode")).toBeNull();
  });
});
