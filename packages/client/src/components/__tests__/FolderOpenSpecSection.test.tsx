import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// Stub the tasks API so the popover doesn't hit the network during these tests.
vi.mock("../../lib/openspec-tasks-api.js", () => ({
  fetchTasks: vi.fn(async () => ({ tasks: [], header: "" })),
  toggleTask: vi.fn(),
  LineMismatchError: class LineMismatchError extends Error {},
}));

import { FolderOpenSpecSection } from "../FolderOpenSpecSection.js";
import type { OpenSpecData, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
