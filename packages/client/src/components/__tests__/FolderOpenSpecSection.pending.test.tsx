/**
 * Spinner branch for `FolderOpenSpecSection` when cold-boot signaling
 * sets `pending: true`. See change: fix-cold-boot-openspec-protocol.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("../../lib/openspec/openspec-tasks-api.js", () => ({
  fetchTasks: vi.fn(async () => ({ tasks: [], header: "" })),
  toggleTask: vi.fn(),
  LineMismatchError: class LineMismatchError extends Error {},
}));

import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const baseProps = {
  cwd: "/p",
  onRefresh: () => {},
};

describe("FolderOpenSpecSection: pending spinner", () => {
  it("renders a spinner when pending: true and not initialized", () => {
    const data: OpenSpecData = { initialized: false, pending: true, changes: [] };
    render(<FolderOpenSpecSection {...baseProps} data={data} />);

    expect(screen.getByTestId("folder-openspec-section-pending")).toBeTruthy();
    expect(screen.getByTestId("folder-openspec-pending-spinner")).toBeTruthy();
    // Standard populated section must NOT render
    expect(screen.queryByTestId("folder-openspec-section")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-header")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-refresh")).toBeNull();
    expect(screen.queryByTestId("folder-archive-btn")).toBeNull();
    expect(screen.queryByTestId("folder-specs-btn")).toBeNull();
  });

  it("renders nothing when pending: false and not initialized", () => {
    const data: OpenSpecData = { initialized: false, pending: false, changes: [] };
    const { container } = render(<FolderOpenSpecSection {...baseProps} data={data} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when pending omitted and not initialized (backwards-compat)", () => {
    const data: OpenSpecData = { initialized: false, changes: [] };
    const { container } = render(<FolderOpenSpecSection {...baseProps} data={data} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the populated header (not the spinner) when initialized: true", () => {
    const data: OpenSpecData = {
      initialized: true,
      pending: false,
      changes: [
        {
          name: "feat-x",
          status: "in-progress",
          completedTasks: 1,
          totalTasks: 3,
          artifacts: [{ id: "tasks", status: "ready" }],
        } as never,
      ],
    };
    render(<FolderOpenSpecSection {...baseProps} data={data} />);

    expect(screen.getByTestId("folder-openspec-section")).toBeTruthy();
    expect(screen.queryByTestId("folder-openspec-section-pending")).toBeNull();
    expect(screen.queryByTestId("folder-openspec-pending-spinner")).toBeNull();
  });

  it("ignores pending: true when initialized is also true (initialized wins)", () => {
    const data: OpenSpecData = {
      initialized: true,
      pending: true,
      changes: [],
    };
    render(<FolderOpenSpecSection {...baseProps} data={data} />);
    expect(screen.getByTestId("folder-openspec-section")).toBeTruthy();
    expect(screen.queryByTestId("folder-openspec-section-pending")).toBeNull();
  });
});
