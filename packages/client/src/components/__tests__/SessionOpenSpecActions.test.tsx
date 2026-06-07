import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SessionOpenSpecActions } from "../SessionOpenSpecActions.js";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  };
}

// PLANNING: not all artifacts done
const planningChange: OpenSpecChange = {
  name: "add-auth",
  status: "in-progress",
  completedTasks: 2,
  totalTasks: 5,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "ready" },
  ],
};

// READY: all artifacts done, status no-tasks
const readyChange: OpenSpecChange = {
  name: "ready-change",
  status: "no-tasks",
  completedTasks: 0,
  totalTasks: 0,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

// IMPLEMENTING: all artifacts done, status in-progress
const implementingChange: OpenSpecChange = {
  name: "impl-change",
  status: "in-progress",
  completedTasks: 2,
  totalTasks: 5,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

// COMPLETE: all artifacts done, status complete
const completeChange: OpenSpecChange = {
  name: "fix-bug",
  status: "complete",
  completedTasks: 3,
  totalTasks: 3,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

const defaultProps = {
  onAttach: vi.fn(),
  onDetach: vi.fn(),
  onSendPrompt: vi.fn(),
};

describe("SessionOpenSpecActions", () => {
  // --- Combo box ---

  it("shows attach button when no proposal attached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange, completeChange]}
        {...defaultProps}
      />,
    );
    const btn = screen.getByTestId("attach-combo") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("Attach change...");
  });

  it("attach button is disabled when no changes", () => {
    render(
      <SessionOpenSpecActions session={makeSession()} changes={[]} {...defaultProps} />,
    );
    const btn = screen.getByTestId("attach-combo") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("No changes");
  });

  it("opens searchable dialog when attach button clicked", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[completeChange, planningChange]}
        {...defaultProps}
      />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    // Dialog should be open with change names visible
    expect(screen.getByText("add-auth")).toBeTruthy();
    expect(screen.getByText("fix-bug")).toBeTruthy();
  });

  it("calls onAttach when change selected from dialog", () => {
    const onAttach = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        {...defaultProps}
        onAttach={onAttach}
      />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });

  // --- Unattached active state: + Change, Explore ---

  it("shows + Change and Explore buttons when active and unattached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.getByTestId("new-change-btn")).toBeTruthy();
    expect(screen.getByTestId("explore-unattached-btn")).toBeTruthy();
  });

  it("hides + Change and Explore when ended and unattached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ status: "ended" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByTestId("new-change-btn")).toBeNull();
    expect(screen.queryByTestId("explore-unattached-btn")).toBeNull();
  });

  it("does not show + Change when a change is attached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByTestId("new-change-btn")).toBeNull();
  });

  // --- Stepper-node click replaces the PDST button ---
  // See change: redesign-session-card-and-composer (stepper-click-to-open).

  it("PDST button removed in attached state — stepper nodes carry that role", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByTestId("artifact-letters-btn")).toBeNull();
    // The stepper P/D/S nodes render in place.
    expect(screen.getByTestId("stepper-node-proposal")).toBeTruthy();
    expect(screen.getByTestId("stepper-node-design")).toBeTruthy();
    expect(screen.getByTestId("stepper-node-specs")).toBeTruthy();
  });

  // --- PLANNING state: Continue, FF, disabled Explore + Archive ---
  // See change: redesign-session-card-and-composer (4.1 + 4.2).
  // Explore is always-rendered-but-disabled when attached. Archive is
  // always-rendered-but-disabled when state !== COMPLETE.

  it("shows disabled Explore, Continue, FF, disabled Archive for PLANNING state", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "active" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.getByTestId("attached-badge").textContent).toContain("add-auth");
    expect(screen.getByTestId("explore-btn")).toBeTruthy();
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("continue-btn")).toBeTruthy();
    expect(screen.getByTestId("ff-btn")).toBeTruthy();
    expect(screen.getByTestId("archive-btn")).toBeTruthy();
    expect((screen.getByTestId("archive-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("archive-btn").getAttribute("title")).toBe("Complete tasks first");
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
    expect(screen.queryByTestId("read-btn")).toBeNull();
    expect(screen.queryByTestId("apply-btn")).toBeNull();
    expect(screen.queryByTestId("verify-btn")).toBeNull();
  });

  // --- READY state: Apply, Explore, Read ---

  it("shows disabled Explore, Apply, disabled Archive for READY state", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "ready-change", status: "active" })}
        changes={[readyChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("apply-btn")).toBeTruthy();
    expect((screen.getByTestId("archive-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
    expect(screen.queryByTestId("continue-btn")).toBeNull();
    expect(screen.queryByTestId("ff-btn")).toBeNull();
    expect(screen.queryByTestId("verify-btn")).toBeNull();
  });

  // --- IMPLEMENTING state: Apply, Explore, Read ---

  it("shows disabled Explore, Apply, disabled Archive for IMPLEMENTING state", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "impl-change", status: "active" })}
        changes={[implementingChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("apply-btn")).toBeTruthy();
    expect((screen.getByTestId("archive-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
    expect(screen.queryByTestId("continue-btn")).toBeNull();
    expect(screen.queryByTestId("ff-btn")).toBeNull();
    expect(screen.queryByTestId("verify-btn")).toBeNull();
  });

  // --- COMPLETE state: Verify, Archive, Explore, Read ---

  it("shows disabled Explore, Verify, enabled Archive for COMPLETE state", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "fix-bug", status: "active" })}
        changes={[completeChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("verify-btn")).toBeTruthy();
    expect(screen.getByTestId("archive-btn")).toBeTruthy();
    expect((screen.getByTestId("archive-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
    expect(screen.queryByTestId("read-btn")).toBeNull();
    expect(screen.queryByTestId("continue-btn")).toBeNull();
    expect(screen.queryByTestId("ff-btn")).toBeNull();
    expect(screen.queryByTestId("apply-btn")).toBeNull();
  });

  // --- Blue badge color ---

  it("renders attached proposal name with text-blue-400", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    const badge = screen.getByTestId("attached-badge");
    const nameSpan = badge.querySelector(".text-blue-400");
    expect(nameSpan).toBeTruthy();
    expect(nameSpan!.textContent).toBe("add-auth");
  });

  // --- Action callbacks ---

  it("Continue sends correct prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "active" })}
        changes={[planningChange]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("continue-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-continue-change add-auth");
  });

  it("Verify sends correct prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "fix-bug", status: "active" })}
        changes={[completeChange]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("verify-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-verify-change fix-bug");
  });

  it("Apply sends correct prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "ready-change", status: "active" })}
        changes={[readyChange]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-apply-change ready-change");
  });

  it("Detach calls onDetach", () => {
    const onDetach = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "active" })}
        changes={[planningChange]}
        {...defaultProps}
        onDetach={onDetach}
      />,
    );
    fireEvent.click(screen.getByTestId("detach-btn"));
    expect(onDetach).toHaveBeenCalledOnce();
  });

  // --- Ended session ---

  it("hides LLM action buttons when session is ended", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "ended" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.getByText(/add-auth/)).toBeTruthy();
    expect(screen.queryByTestId("explore-btn")).toBeNull();
    expect(screen.queryByTestId("continue-btn")).toBeNull();
    expect(screen.queryByTestId("ff-btn")).toBeNull();
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
  });

  // --- Stepper Proposal-node click calls onReadArtifact ---

  it("calls onReadArtifact with proposal when the stepper Proposal node is clicked", () => {
    const onReadArtifact = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("stepper-node-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
  });

  // --- Disabled when not active ---

  it("keeps Explore disabled (attached) but enables other buttons when session is idle", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "idle" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    // Explore stays disabled because a proposal is attached (4.1).
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("continue-btn") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("ff-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables action buttons when session is streaming", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "streaming" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("continue-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Explore disabled (attached) but enables Continue when session is active", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "active" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("continue-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables action buttons when session is streaming", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "streaming" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect((screen.getByTestId("explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("continue-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  // --- Attached change not found ---

  it("shows badge + Detach only when attached change not in data", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "archived-change" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.getByText(/archived-change/)).toBeTruthy();
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
    expect(screen.queryByTestId("explore-btn")).toBeNull();
    expect(screen.queryByTestId("continue-btn")).toBeNull();
  });

  // --- Bulk Archive ---

  describe("bulk archive", () => {
    const completedChange: OpenSpecChange = {
      name: "done-feat",
      status: "complete",
      completedTasks: 4,
      totalTasks: 4,
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "tasks", status: "done" },
      ],
    };

    // Bulk Archive hidden in unattached branch per user feedback
    // ("archive and bulk archive is meaningless when no openspec attached").
    // See change: redesign-session-card-and-composer (cleanup-pass).
    it("hides Bulk Archive in the unattached branch even with completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    it("hides Bulk Archive button when no completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    // Bulk-archive confirmation + streaming-disabled paths are now
    // exercised through the folder-level UI (FolderOpenSpecSection) since
    // the per-session card no longer surfaces Bulk Archive at all.
    // See change: redesign-session-card-and-composer (cleanup-pass).

    it("hides Bulk Archive on attached session with completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "add-auth" })}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    it.skip("shows Bulk Archive on unattached session with same sibling completed change (REMOVED — unattached now has no archive surface)", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.getByTestId("bulk-archive-btn")).toBeTruthy();
    });
  });

  // --- State pill ---

  describe("state pill", () => {
    it("renders IMPLEMENTING pill for attached implementing change", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change" })}
          changes={[implementingChange]}
          {...defaultProps}
        />,
      );
      const pill = screen.getByTestId("state-pill");
      expect(pill.getAttribute("data-state")).toBe("IMPLEMENTING");
      expect(pill.textContent).toBe("IMPLEMENTING");
    });

    it("renders COMPLETE pill for attached complete change", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "fix-bug" })}
          changes={[completeChange]}
          {...defaultProps}
        />,
      );
      expect(screen.getByTestId("state-pill").getAttribute("data-state")).toBe("COMPLETE");
    });

    it("hides pill when attached change is missing from data", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "archived-change" })}
          changes={[planningChange]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("state-pill")).toBeNull();
    });
  });

  // --- Archive-anyway as a plain button ---
  // Was an overflow menu with a single item — now a direct button.
  // See change: redesign-session-card-and-composer (cleanup-pass).

  describe("archive-anyway button", () => {
    const implementingCompleteChange: OpenSpecChange = {
      ...implementingChange,
      isComplete: true,
    };

    it("renders Archive anyway button when IMPLEMENTING + isComplete + all artifacts done", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "active" })}
          changes={[implementingCompleteChange]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("overflow-btn")).toBeNull();
      expect(screen.getByTestId("archive-anyway-btn")).toBeTruthy();
    });

    it("hides Archive anyway when isComplete is false", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "active" })}
          changes={[{ ...implementingChange, isComplete: false }]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("archive-anyway-btn")).toBeNull();
    });

    it("hides Archive anyway when isComplete is undefined", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "active" })}
          changes={[implementingChange]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("archive-anyway-btn")).toBeNull();
    });

    it("hides Archive anyway in COMPLETE state", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "fix-bug", status: "active" })}
          changes={[{ ...completeChange, isComplete: true }]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("archive-anyway-btn")).toBeNull();
    });

    it("hides Archive anyway when not all artifacts are done", () => {
      const planningIsComplete: OpenSpecChange = {
        name: "planning-ic",
        status: "in-progress",
        completedTasks: 2,
        totalTasks: 5,
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "design", status: "ready" },
        ],
        isComplete: true,
      };
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "planning-ic", status: "active" })}
          changes={[planningIsComplete]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("archive-anyway-btn")).toBeNull();
    });

    it("clicking Archive anyway opens confirm dialog and dispatches archive prompt", () => {
      const onSendPrompt = vi.fn();
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "active" })}
          changes={[implementingCompleteChange]}
          {...defaultProps}
          onSendPrompt={onSendPrompt}
        />,
      );
      fireEvent.click(screen.getByTestId("archive-anyway-btn"));
      // 2/5 complete → 3 unchecked of 5
      expect(screen.getByText(/3 of 5 tasks are unchecked/)).toBeTruthy();
      fireEvent.click(screen.getByTestId("archive-anyway-confirm-action"));
      expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-archive-change impl-change");
    });
  });

  // --- Tasks button removed; stepper Tasks node now opens TasksPopover ---
  // See change: redesign-session-card-and-composer (cleanup-pass).

  describe("tasks button (removed)", () => {
    it("no standalone Tasks N/M button — stepper Tasks node handles it", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "active" })}
          changes={[implementingChange]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("tasks-btn")).toBeNull();
      // Stepper Tasks node is rendered + clickable.
      const node = screen.getByTestId("stepper-node-tasks");
      expect(node.getAttribute("data-clickable")).toBe("true");
    });

    it("hides Tasks button when totalTasks is 0", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "ready-change", status: "active" })}
          changes={[readyChange]}
          {...defaultProps}
        />,
      );
      expect(screen.queryByTestId("tasks-btn")).toBeNull();
    });
  });
});
