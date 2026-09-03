/**
 * FolderOpenSpecSection — slim navigation entry to the full-page OpenSpec
 * board. The inline accordion (change tree, group pills, search, DnD, session
 * rows) moved to OpenSpecBoardView. See change: redesign-openspec-board.
 *
 * The section is now STATE-ONLY: Refresh / Specs / Archive are folder-actions-menu
 * items contributed host-side by `SessionList`, so this file asserts their
 * ABSENCE here and `SessionList.folder-menu.test.tsx` asserts their presence
 * there. See change: move-slot-actions-to-menu.
 */

import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";

afterEach(() => cleanup());

const mockData: OpenSpecData = {
  initialized: true,
  changes: [
    { name: "feat-complete", status: "complete", completedTasks: 4, totalTasks: 4, artifacts: [] },
    { name: "feat-in-progress", status: "in-progress", completedTasks: 2, totalTasks: 5, artifacts: [] },
  ],
};

const defaultProps = {
  data: mockData,
  cwd: "/project/foo",
};

describe("FolderOpenSpecSection (navigation entry)", () => {
  it("renders a SlotPill entry with the change count", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    const pill = screen.getByTestId("folder-openspec-open-board");
    expect(pill.textContent).toContain("OpenSpec");
    expect(screen.getByTestId("folder-openspec-count").textContent).toBe("2");
  });

  it("does not render an inline change tree", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.queryByTestId("folder-openspec-changes")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-grouped")).toBeNull();
    expect(screen.queryByText("feat-in-progress")).toBeNull();
  });

  it("navigates to the board on click", () => {
    const onOpenBoard = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onOpenBoard={onOpenBoard} />);
    fireEvent.click(screen.getByTestId("folder-openspec-open-board"));
    expect(onOpenBoard).toHaveBeenCalledWith("/project/foo");
  });

  it("renders no action control of its own \u2014 refresh, specs and archive are menu items", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.queryByTestId("folder-openspec-refresh")).toBeNull();
    expect(screen.queryByTestId("folder-specs-btn")).toBeNull();
    expect(screen.queryByTestId("folder-archive-btn")).toBeNull();
  });

  it("the pill grid cell holds exactly one control \u2014 the pill root itself", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    const section = screen.getByTestId("folder-openspec-section");
    const pill = screen.getByTestId("folder-openspec-open-board");
    const interactive = Array.from(
      section.querySelectorAll("button, a, [role='button'], [tabindex]:not([tabindex='-1'])"),
    );
    expect(interactive).toEqual([pill]);
  });

  it("does not render when not initialized", () => {
    const { container } = render(
      <FolderOpenSpecSection {...defaultProps} data={{ initialized: false, changes: [] }} />,
    );
    expect(container.querySelector('[data-testid="folder-openspec-section"]')).toBeNull();
  });
});
