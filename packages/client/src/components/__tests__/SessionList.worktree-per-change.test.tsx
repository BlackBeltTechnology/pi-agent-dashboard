/**
 * Per-change `New worktree` action on the OpenSpec board proposal card.
 *
 * The inline `⑂+` button moved from `FolderOpenSpecSection` to the board's
 * proposal-card action footer. This verifies the card action fires
 * `onSpawnAttachedWorktree(cwd, changeName)` and is gated by
 * `worktreeAvailability`. Unavailability is rendered DISABLED-with-reason,
 * never hidden — a vanished button is indistinguishable from a render bug.
 * The full dialog→spawn e2e is covered by `WorktreeSpawnDialog` tests.
 *
 * See changes: redesign-openspec-board,
 * fix-openspec-board-worktree-button-gating.
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
import { resolveWorktreeAvailability } from "../../lib/git/folder-worktree-availability.js";
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

const threeChanges: OpenSpecData = {
  initialized: true,
  changes: [
    { name: "add-dark-mode", status: "in-progress", completedTasks: 1, totalTasks: 4, artifacts: [{ id: "proposal", status: "done" }] },
    { name: "add-light-mode", status: "in-progress", completedTasks: 0, totalTasks: 2, artifacts: [{ id: "proposal", status: "done" }] },
    { name: "add-auto-mode", status: "in-progress", completedTasks: 2, totalTasks: 2, artifacts: [{ id: "proposal", status: "done" }] },
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
    worktreeAvailability: { available: true } as const,
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

  // F1 — rewrites the former "hidden on non-git folder" absence assertion.
  it("unavailable worktree action stays VISIBLE, disabled and explained (non-git folder)", () => {
    render(<OpenSpecBoardView {...baseProps()} worktreeAvailability={{ available: false, reason: "not-a-git-repo" }} />);
    const btn = screen.getByTestId("card-new-worktree-add-dark-mode") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("title")).toBe("This folder is not a git repository");
  });

  // F2 — rewrites the former "hidden when gitWorktreeEnabled=false" assertion.
  it("preference-off reason is shown on EVERY card", () => {
    render(<OpenSpecBoardView {...baseProps()} data={threeChanges} openspecMap={new Map([["/project/foo", threeChanges]])} worktreeAvailability={{ available: false, reason: "worktrees-disabled" }} />);
    for (const name of ["add-dark-mode", "add-light-mode", "add-auto-mode"]) {
      const btn = screen.getByTestId(`card-new-worktree-${name}`) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("title")).toBe("Worktrees are disabled in Settings");
    }
  });

  // F3 — cold load: availability resolves as enabled before `/api/config` lands.
  it("does not flash a disabled/Settings state on cold load", () => {
    render(<OpenSpecBoardView {...baseProps()} worktreeAvailability={resolveWorktreeAvailability({ cwd: "/project/foo", sessions: [], folderGitMap: new Map(), gitWorktreeEnabled: undefined })} />);
    const btn = screen.getByTestId("card-new-worktree-add-dark-mode") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("title")).not.toMatch(/Settings/);
  });

  // F4 — the new-proposal dialog follows the same availability.
  it("new-proposal dialog offers no worktree option when unavailable", () => {
    render(<OpenSpecBoardView {...baseProps()} worktreeAvailability={{ available: false, reason: "not-a-git-repo" }} />);
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    expect(screen.getByTestId("np-name")).toBeTruthy();
    expect(screen.queryByTestId("np-worktree")).toBeNull();
  });

  // X3 — a forced click on the disabled action is inert.
  it("disabled worktree action is inert when clicked", () => {
    const props = { ...baseProps(), worktreeAvailability: { available: false, reason: "not-a-git-repo" } as const };
    render(<OpenSpecBoardView {...props} />);
    fireEvent.click(screen.getByTestId("card-new-worktree-add-dark-mode"));
    expect(props.onSpawnAttachedWorktree).not.toHaveBeenCalled();
    expect(screen.queryByTestId("np-name")).toBeNull();
  });
});
