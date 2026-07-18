/**
 * FolderOpenSpecSection — slim navigation entry to the full-page OpenSpec
 * board. The inline accordion (change tree, group pills, search, DnD, session
 * rows) moved to OpenSpecBoardView. See change: redesign-openspec-board.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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
  onRefresh: vi.fn(),
};

describe("FolderOpenSpecSection (navigation entry)", () => {
  it("renders a single-line entry with the change count", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.getByTestId("folder-openspec-open-board")).toBeTruthy();
    expect(screen.getByText("OpenSpec (2)")).toBeTruthy();
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

  it("calls onRefresh when the refresh control is clicked", () => {
    const onRefresh = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("folder-openspec-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("shows the Specs button and calls onOpenSpecs", () => {
    const onOpenSpecs = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onOpenSpecs={onOpenSpecs} />);
    fireEvent.click(screen.getByTestId("folder-specs-btn"));
    expect(onOpenSpecs).toHaveBeenCalledTimes(1);
  });

  it("shows the Archive button and calls onOpenArchive", () => {
    const onOpenArchive = vi.fn();
    render(<FolderOpenSpecSection {...defaultProps} onOpenArchive={onOpenArchive} />);
    fireEvent.click(screen.getByTestId("folder-archive-btn"));
    expect(onOpenArchive).toHaveBeenCalledTimes(1);
  });

  it("hides Specs/Archive buttons when handlers not provided", () => {
    render(<FolderOpenSpecSection {...defaultProps} />);
    expect(screen.queryByTestId("folder-specs-btn")).toBeNull();
    expect(screen.queryByTestId("folder-archive-btn")).toBeNull();
  });

  it("does not render when not initialized", () => {
    const { container } = render(
      <FolderOpenSpecSection {...defaultProps} data={{ initialized: false, changes: [] }} />,
    );
    expect(container.querySelector('[data-testid="folder-openspec-section"]')).toBeNull();
  });
});
