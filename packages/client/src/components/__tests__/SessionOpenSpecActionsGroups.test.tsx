/**
 * Component tests for SessionOpenSpecActions group integration.
 * See change: add-openspec-change-grouping (task 9.5).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("../../lib/openspec-tasks-api.js", () => ({
  fetchTasks: vi.fn(async () => ({ tasks: [], header: "" })),
  toggleTask: vi.fn(),
  LineMismatchError: class LineMismatchError extends Error {},
}));

import { SessionOpenSpecActions } from "../SessionOpenSpecActions.js";
import type { DashboardSession, OpenSpecChange, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const session: DashboardSession = {
  id: "s1",
  cwd: "/project",
  status: "idle",
  attachedProposal: undefined,
} as any;

const changes: OpenSpecChange[] = [
  { name: "add-auth", status: "in-progress", completedTasks: 2, totalTasks: 5, artifacts: [], groupId: "backend" },
  { name: "fix-ui", status: "in-progress", completedTasks: 1, totalTasks: 3, artifacts: [], groupId: null },
];

const groups: OpenSpecGroup[] = [
  { id: "backend", name: "Backend", color: "#22c55e", order: 0 },
];
const assignments: Record<string, string> = {
  "add-auth": "backend",
};

const baseProps = {
  session,
  changes,
  onAttach: vi.fn(),
  onDetach: vi.fn(),
  onSendPrompt: vi.fn(),
};

describe("SessionOpenSpecActions — groups", () => {
  it("uses grouped dialog when groups exist", () => {
    render(
      <SessionOpenSpecActions {...baseProps} groups={groups} assignments={assignments} />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    expect(screen.getByTestId("grouped-attach-dialog")).toBeTruthy();
    expect(screen.getByTestId("group-pills")).toBeTruthy();
  });

  it("uses flat dialog when no groups", () => {
    render(
      <SessionOpenSpecActions {...baseProps} groups={[]} assignments={{}} />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    // Should NOT have grouped dialog
    expect(screen.queryByTestId("grouped-attach-dialog")).toBeNull();
  });

  it("pill state resets on dialog close and reopen", () => {
    render(
      <SessionOpenSpecActions {...baseProps} groups={groups} assignments={assignments} />,
    );
    // Open dialog
    fireEvent.click(screen.getByTestId("attach-combo"));
    expect(screen.getByTestId("grouped-attach-dialog")).toBeTruthy();
    // Select a pill
    fireEvent.click(screen.getByTestId("group-pill-backend"));
    // Close by clicking the overlay (sibling of the dialog container)
    const overlay = screen.getByTestId("grouped-attach-dialog-overlay");
    fireEvent.click(overlay);
    // Reopen
    fireEvent.click(screen.getByTestId("attach-combo"));
    // "All" pill should be active again (default state after remount)
    const allPill = screen.getByTestId("group-pill-all");
    expect(allPill.className).toContain("blue-500");
  });

  it("selecting from grouped dialog calls onAttach", () => {
    const onAttach = vi.fn();
    render(
      <SessionOpenSpecActions {...baseProps} onAttach={onAttach} groups={groups} assignments={assignments} />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    fireEvent.click(screen.getByTestId("attach-option-add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });

  it("inline combo box remains flat (no group structure)", () => {
    render(
      <SessionOpenSpecActions {...baseProps} groups={groups} assignments={assignments} />,
    );
    const combo = screen.getByTestId("attach-combo");
    // Should just say "Attach change..." not show group info
    expect(combo.textContent).toContain("Attach change");
  });
});
