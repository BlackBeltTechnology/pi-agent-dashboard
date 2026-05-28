import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// Stub the tasks API so the popover doesn't hit the network during these tests.
vi.mock("../../lib/openspec-tasks-api.js", () => ({
  fetchTasks: vi.fn(async () => ({ tasks: [], header: "" })),
  toggleTask: vi.fn(),
  LineMismatchError: class LineMismatchError extends Error {},
}));

// Stub the groups API.
vi.mock("../../lib/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {} })),
  createGroup: vi.fn(async () => ({ id: "new", name: "New", order: 0 })),
  updateGroup: vi.fn(async () => ({ id: "ui", name: "UI", order: 0 })),
  deleteGroup: vi.fn(async () => {}),
  setAssignment: vi.fn(async () => {}),
}));

import { FolderOpenSpecSection } from "../FolderOpenSpecSection.js";
import type { OpenSpecData, OpenSpecGroup, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const mockData: OpenSpecData = {
  initialized: true,
  changes: [
    {
      name: "feat-complete",
      status: "complete",
      completedTasks: 4,
      totalTasks: 4,
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "done" },
        { id: "specs", status: "done" },
        { id: "tasks", status: "done" },
      ],
    },
    {
      name: "feat-in-progress",
      status: "in-progress",
      completedTasks: 2,
      totalTasks: 5,
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "design", status: "ready" },
        { id: "specs", status: "blocked" },
        { id: "tasks", status: "blocked" },
      ],
    },
  ],
};

const defaultProps = {
  data: mockData,
  cwd: "/project/foo",
  onRefresh: vi.fn(),
};

describe("FolderOpenSpecSection", () => {
  it("renders collapsed by default", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.getByTestId("folder-openspec-header")).toBeTruthy();
    expect(screen.getByText("OpenSpec (2 changes)")).toBeTruthy();
    expect(screen.queryByTestId("folder-openspec-changes")).toBeNull();
  });

  it("does not render when not initialized", () => {
    const { container } = render(
      <FolderOpenSpecSection {...defaultProps} data={{ initialized: false, changes: [] }} />,
    );
    expect(container.querySelector('[data-testid="folder-openspec-section"]')).toBeNull();
  });

  it("expands and collapses on header click", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    const header = screen.getByTestId("folder-openspec-header");

    fireEvent.click(header);
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();

    fireEvent.click(header);
    expect(screen.queryByTestId("folder-openspec-changes")).toBeNull();
  });

  it("sorts in-progress changes before complete", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const names = screen.getAllByTestId("change-name");
    expect(names[0].textContent).toBe("feat-in-progress");
    expect(names[1].textContent).toBe("feat-complete");
  });

  it("shows PDST buttons and task counts", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByText("2/5 tasks")).toBeTruthy();
    expect(screen.getByText("4/4 tasks")).toBeTruthy();
    const btns = screen.getAllByTestId("artifact-letters-btn");
    expect(btns).toHaveLength(2);
    expect(btns[0].textContent).toBe("PDST");
  });

  it("calls onRefresh when refresh button clicked", () => {
    const onRefresh = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("folder-openspec-refresh"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows Specs button and calls onOpenSpecs", () => {
    const onOpenSpecs = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onOpenSpecs={onOpenSpecs} />);

    fireEvent.click(screen.getByTestId("folder-specs-btn"));
    expect(onOpenSpecs).toHaveBeenCalledOnce();
  });

  it("calls onReadArtifact with proposal when PDST button clicked", () => {
    const onReadArtifact = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onReadArtifact={onReadArtifact} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));

    const btns = screen.getAllByTestId("artifact-letters-btn");
    fireEvent.click(btns[0]);
    expect(onReadArtifact).toHaveBeenCalledWith("feat-in-progress", "proposal");
  });

  it("does not show Specs button when onOpenSpecs not provided", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.queryByTestId("folder-specs-btn")).toBeNull();
  });

  // --- Cross-session links ---

  const activeSession: DashboardSession = {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
  };

  it("shows session links for changes with attached sessions", () => {
    const sessionWithAttachment: DashboardSession = {
      ...activeSession,
      id: "s3",
      name: "auth-session",
      attachedProposal: "feat-in-progress",
    };
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[sessionWithAttachment]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const links = screen.getAllByTestId("session-link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("auth-session");
  });

  it("clicking session link calls onNavigateToSession", () => {
    const onNavigate = vi.fn();
    const sessionWithAttachment: DashboardSession = {
      ...activeSession,
      id: "s3",
      attachedProposal: "feat-in-progress",
    };
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[sessionWithAttachment]}
        onNavigateToSession={onNavigate}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("session-link"));
    expect(onNavigate).toHaveBeenCalledWith("s3");
  });

  it("shows no session links when no sessions attached to change", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[activeSession]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryAllByTestId("session-link")).toHaveLength(0);
  });

  // --- Linked-session pill lifecycle icons ---

  const liveAttached: DashboardSession = {
    id: "s-live",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    attachedProposal: "feat-in-progress",
    sessionFile: "/sf/live.jsonl",
  };

  it("alive + not hidden → hide icon, fork icon, no unhide, no resume", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[liveAttached]}
        onNavigateToSession={vi.fn()}
        onHideSession={vi.fn()}
        onUnhideSession={vi.fn()}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("linked-session-hide")).toBeTruthy();
    expect(screen.queryByTestId("linked-session-unhide")).toBeNull();
    expect(screen.queryByTestId("linked-session-resume")).toBeNull();
    expect(screen.queryByTestId("linked-session-fork")).toBeTruthy();
  });

  it("hidden → unhide icon + resume icon", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[{ ...liveAttached, hidden: true }]}
        onNavigateToSession={vi.fn()}
        onHideSession={vi.fn()}
        onUnhideSession={vi.fn()}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("linked-session-unhide")).toBeTruthy();
    expect(screen.queryByTestId("linked-session-hide")).toBeNull();
    expect(screen.queryByTestId("linked-session-resume")).toBeTruthy();
  });

  it("ended (not alive) → resume icon visible", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[{ ...liveAttached, status: "ended" }]}
        onNavigateToSession={vi.fn()}
        onHideSession={vi.fn()}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("linked-session-resume")).toBeTruthy();
  });

  it("no sessionFile → no resume, no fork", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[{ ...liveAttached, sessionFile: undefined, status: "ended" }]}
        onNavigateToSession={vi.fn()}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("linked-session-resume")).toBeNull();
    expect(screen.queryByTestId("linked-session-fork")).toBeNull();
  });

  it("clicking each lifecycle icon fires its callback and does NOT navigate", () => {
    const onNavigate = vi.fn();
    const onHide = vi.fn();
    const onResume = vi.fn();
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[liveAttached]}
        onNavigateToSession={onNavigate}
        onHideSession={onHide}
        onResumeSession={onResume}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));

    fireEvent.click(screen.getByTestId("linked-session-hide"));
    expect(onHide).toHaveBeenCalledWith("s-live");
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("linked-session-fork"));
    expect(onResume).toHaveBeenCalledWith("s-live", "fork");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("clicking unhide fires onUnhideSession with id", () => {
    const onUnhide = vi.fn();
    const onNavigate = vi.fn();
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[{ ...liveAttached, hidden: true }]}
        onNavigateToSession={onNavigate}
        onUnhideSession={onUnhide}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("linked-session-unhide"));
    expect(onUnhide).toHaveBeenCalledWith("s-live");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("clicking resume fires onResumeSession with continue mode", () => {
    const onResume = vi.fn();
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[{ ...liveAttached, status: "ended" }]}
        onNavigateToSession={vi.fn()}
        onResumeSession={onResume}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("linked-session-resume"));
    expect(onResume).toHaveBeenCalledWith("s-live", "continue");
  });

  it("clicking the name region still navigates", () => {
    const onNavigate = vi.fn();
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        sessions={[liveAttached]}
        onNavigateToSession={onNavigate}
        onHideSession={vi.fn()}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("session-link"));
    expect(onNavigate).toHaveBeenCalledWith("s-live");
  });

  it("does not render + Change button", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.queryByTestId("folder-new-change-btn")).toBeNull();
  });

  // --- Clickable task counter (change: add-folder-task-checker-and-spawn-attach) ---

  it("renders task counter as a button when totalTasks > 0", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const btn = screen.getByTestId("folder-tasks-counter-feat-in-progress");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toBe("2/5 tasks");
  });

  it("does not render a tasks-counter button when totalTasks === 0", () => {
    const zeroTasksData: OpenSpecData = {
      initialized: true,
      changes: [{ ...mockData.changes[1]!, completedTasks: 0, totalTasks: 0 }],
    };
    render(<FolderOpenSpecSection {...defaultProps} data={zeroTasksData} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("folder-tasks-counter-feat-in-progress")).toBeNull();
  });

  it("clicking the task counter opens TasksPopover with cwd + change", async () => {
    const { fetchTasks } = await import("../../lib/openspec-tasks-api.js");
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("folder-tasks-counter-feat-in-progress"));
    // The popover mounts and immediately calls fetchTasks(cwd, change).
    expect(fetchTasks).toHaveBeenCalledWith("/project/foo", "feat-in-progress", expect.anything());
  });

  it("clicking the task counter does not toggle the section collapse", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();
    fireEvent.click(screen.getByTestId("folder-tasks-counter-feat-in-progress"));
    // Section is still expanded.
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();
  });

  it("clicking a second counter swaps the popover (only one open at a time)", async () => {
    const { fetchTasks } = await import("../../lib/openspec-tasks-api.js");
    (fetchTasks as ReturnType<typeof vi.fn>).mockClear();
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("folder-tasks-counter-feat-in-progress"));
    fireEvent.click(screen.getByTestId("folder-tasks-counter-feat-complete"));
    // Two distinct mounts, last fetch is for the second change.
    const calls = (fetchTasks as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1]![1]).toBe("feat-complete");
  });

  // --- Spawn-with-attach button (change: add-folder-task-checker-and-spawn-attach) ---

  it("renders spawn-attached button when onSpawnAttached prop is provided", () => {
    render(<FolderOpenSpecSection {...defaultProps} onSpawnAttached={vi.fn()} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("spawn-attached-btn-feat-in-progress")).toBeTruthy();
    expect(screen.getByTestId("spawn-attached-btn-feat-complete")).toBeTruthy();
  });

  it("does not render spawn-attached button when callback is absent", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-btn-feat-in-progress")).toBeNull();
  });

  it("clicking spawn-attached invokes callback with (cwd, changeName)", () => {
    const onSpawnAttached = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onSpawnAttached={onSpawnAttached} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("spawn-attached-btn-feat-in-progress"));
    expect(onSpawnAttached).toHaveBeenCalledOnce();
    expect(onSpawnAttached).toHaveBeenCalledWith("/project/foo", "feat-in-progress");
  });

  it("clicking spawn-attached does not toggle section collapse", () => {
    render(<FolderOpenSpecSection {...defaultProps} onSpawnAttached={vi.fn()} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();
    fireEvent.click(screen.getByTestId("spawn-attached-btn-feat-in-progress"));
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();
  });
});

// --- Per-change ⥂2+ worktree button (change: openspec-worktree-spawn-button) ---

describe("FolderOpenSpecSection — ⥂2+ per-change worktree button", () => {
  it("renders ⥂2+ when isGitRepo + gitWorktreeEnabled + handler all set", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={true}
        gitWorktreeEnabled={true}
        onSpawnAttachedWorktree={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("spawn-attached-worktree-btn-feat-in-progress")).toBeTruthy();
    expect(screen.getByTestId("spawn-attached-worktree-btn-feat-complete")).toBeTruthy();
  });

  it("hides ⥂2+ when isGitRepo is false", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={false}
        gitWorktreeEnabled={true}
        onSpawnAttachedWorktree={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-worktree-btn-feat-in-progress")).toBeNull();
  });

  it("hides ⥂2+ when gitWorktreeEnabled is false", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={true}
        gitWorktreeEnabled={false}
        onSpawnAttachedWorktree={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-worktree-btn-feat-in-progress")).toBeNull();
  });

  it("hides ⥂2+ when handler is undefined", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={true}
        gitWorktreeEnabled={true}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("spawn-attached-worktree-btn-feat-in-progress")).toBeNull();
  });

  it("clicking ⥂2+ invokes handler with (cwd, changeName)", () => {
    const onSpawnAttachedWorktree = vi.fn();
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={true}
        gitWorktreeEnabled={true}
        onSpawnAttachedWorktree={onSpawnAttachedWorktree}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    fireEvent.click(screen.getByTestId("spawn-attached-worktree-btn-feat-in-progress"));
    expect(onSpawnAttachedWorktree).toHaveBeenCalledOnce();
    expect(onSpawnAttachedWorktree).toHaveBeenCalledWith("/project/foo", "feat-in-progress");
  });

  it("existing spawn-attached button is unaffected", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        isGitRepo={true}
        gitWorktreeEnabled={true}
        onSpawnAttached={vi.fn()}
        onSpawnAttachedWorktree={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("spawn-attached-btn-feat-in-progress")).toBeTruthy();
    expect(screen.getByTestId("spawn-attached-worktree-btn-feat-in-progress")).toBeTruthy();
  });
});

// ── Group integration tests (task 7.9) ──

const testGroups: OpenSpecGroup[] = [
  { id: "ui", name: "UI", color: "#3b82f6", order: 0 },
  { id: "server", name: "Server", color: "#22c55e", order: 1 },
];
const testAssignments: Record<string, string> = {
  "feat-in-progress": "ui",
};

describe("FolderOpenSpecSection — groups", () => {
  it("shows grouped view when groups are provided", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("group-pills")).toBeTruthy();
    expect(screen.getByTestId("group-section-ui")).toBeTruthy();
    expect(screen.getByTestId("group-section-server")).toBeTruthy();
    expect(screen.getByTestId("group-section-ungrouped")).toBeTruthy();
  });

  it("preserves flat view with zero groups (today's behavior)", () => {
    render(<FolderOpenSpecSection {...defaultProps} groups={[]} assignments={{}} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("folder-openspec-changes")).toBeTruthy();
    expect(screen.queryByTestId("group-pills")).toBeNull();
  });

  it("pill switching filters changes", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    // Click the UI pill
    fireEvent.click(screen.getByTestId("group-pill-ui"));
    // feat-in-progress is assigned to "ui" and should be in the UI section
    const uiSection = screen.getByTestId("group-section-ui");
    expect(uiSection.textContent).toContain("feat-in-progress");
  });

  it("search filter composes with pill (AND)", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const searchInput = screen.getByTestId("folder-openspec-search");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    // All sections should show empty-state messages
    expect(screen.queryAllByTestId("change-name").length).toBe(0);
  });

  it("unfiltered header count stays correct", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    // Header should show total count regardless of filter
    expect(screen.getByTestId("folder-openspec-header").textContent).toContain("2 changes");
  });

  it("bootstrap CTA visible when 0 groups + ≥1 changes", () => {
    render(<FolderOpenSpecSection {...defaultProps} groups={[]} assignments={{}} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.getByTestId("bootstrap-create-group-btn")).toBeTruthy();
  });

  it("no bootstrap CTA when groups exist", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("bootstrap-create-group-btn")).toBeNull();
  });

  it("no bootstrap CTA when zero changes", () => {
    const noChanges: OpenSpecData = { initialized: true, changes: [] };
    render(<FolderOpenSpecSection {...defaultProps} data={noChanges} groups={[]} assignments={{}} />);
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("bootstrap-create-group-btn")).toBeNull();
  });

  it("per-row group picker visible when groups exist", () => {
    render(
      <FolderOpenSpecSection
        {...defaultProps}
        groups={testGroups}
        assignments={testAssignments}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryAllByTestId("group-picker").length).toBeGreaterThan(0);
  });
});

// ── Linked-session status icon (change: add-session-status-to-folder-proposal-rows) ──

const baseAttached: DashboardSession = {
  id: "s-attached",
  cwd: "/project/foo",
  source: "tui",
  status: "idle",
  startedAt: Date.now(),
  attachedProposal: "feat-in-progress",
  sessionFile: "/sf/x.jsonl",
};

const baseProps = {
  data: mockData,
  cwd: "/project/foo",
  onRefresh: vi.fn(),
};

describe("linked-session status icon", () => {
  it("idle session → text-green-500, no animate-pulse", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[{ ...baseAttached, status: "idle" }]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const icon = screen.getByTestId("linked-session-status-icon");
    expect(icon.className).toContain("text-green-500");
    expect(icon.className).not.toContain("animate-pulse");
  });

  it("streaming session → text-yellow-500 + animate-pulse", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[{ ...baseAttached, status: "streaming" }]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const icon = screen.getByTestId("linked-session-status-icon");
    expect(icon.className).toContain("text-yellow-500");
    expect(icon.className).toContain("animate-pulse");
  });

  it("ended session → text-[var(--text-muted)], no animate-pulse", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[{ ...baseAttached, status: "ended" }]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const icon = screen.getByTestId("linked-session-status-icon");
    expect(icon.className).toContain("text-[var(--text-muted)]");
    expect(icon.className).not.toContain("animate-pulse");
  });

  it("resuming session → text-yellow-500 + animate-pulse (overrides status)", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[{ ...baseAttached, status: "ended", resuming: true }]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const icon = screen.getByTestId("linked-session-status-icon");
    expect(icon.className).toContain("text-yellow-500");
    expect(icon.className).toContain("animate-pulse");
  });

  it("ask_user (currentTool) does NOT add pulse — icon stays green (status-only)", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[{ ...baseAttached, status: "idle", currentTool: "ask_user" }]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const icon = screen.getByTestId("linked-session-status-icon");
    expect(icon.className).toContain("text-green-500");
    expect(icon.className).not.toContain("animate-pulse");
  });
});

describe("selected linked-session row", () => {
  const sessionA: DashboardSession = { ...baseAttached, id: "sA" };
  const sessionB: DashboardSession = { ...baseAttached, id: "sB" };

  it("selected row carries data-selected=true and border-blue-500/60", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[sessionA, sessionB]}
        selectedId="sA"
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const rows = screen.getAllByTestId("linked-session-row");
    expect(rows).toHaveLength(2);
    const selected = rows.find((r) => r.getAttribute("data-selected") === "true")!;
    expect(selected).toBeTruthy();
    expect(selected.className).toContain("border-blue-500/60");
    // Selection style is border-only — no ring, no blue tint
    expect(selected.className).not.toContain("ring-1");
    expect(selected.className).not.toContain("bg-blue-500/5");
  });

  it("unselected row has no data-selected and border-transparent", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[sessionA, sessionB]}
        selectedId="sA"
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const rows = screen.getAllByTestId("linked-session-row");
    const unselected = rows.find((r) => r.getAttribute("data-selected") !== "true")!;
    expect(unselected).toBeTruthy();
    expect(unselected.className).toContain("border-transparent");
  });

  it("selectedId undefined → all rows render border-transparent and none carry data-selected", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[sessionA, sessionB]}
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const rows = screen.getAllByTestId("linked-session-row");
    for (const r of rows) {
      expect(r.getAttribute("data-selected")).toBeNull();
      expect(r.className).toContain("border-transparent");
    }
  });

  it("row height invariant: selected and unselected rows both carry the `border` token", () => {
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[sessionA, sessionB]}
        selectedId="sA"
        onNavigateToSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    const rows = screen.getAllByTestId("linked-session-row");
    for (const r of rows) {
      // Class list contains the `border` utility token (not just `border-foo`).
      expect(r.className.split(/\s+/)).toContain("border");
    }
  });

  it("regression: lifecycle icons still render and stop propagation after row className refactor", () => {
    const onNavigate = vi.fn();
    const onHide = vi.fn();
    render(
      <FolderOpenSpecSection
        {...baseProps}
        sessions={[sessionA]}
        selectedId="sA"
        onNavigateToSession={onNavigate}
        onHideSession={onHide}
        onResumeSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("folder-openspec-header"));
    expect(screen.queryByTestId("linked-session-hide")).toBeTruthy();
    expect(screen.queryByTestId("linked-session-fork")).toBeTruthy();
    fireEvent.click(screen.getByTestId("linked-session-hide"));
    expect(onHide).toHaveBeenCalledWith("sA");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
