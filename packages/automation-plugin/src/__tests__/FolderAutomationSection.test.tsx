/**
 * FolderAutomationSection slot render: OpenSpec-parity markup (uppercase
 * title + count + →, refresh, blue `+ New` chip), navigation to the
 * shell-overlay board `/folder/:encodedCwd/automations`, and `+ New` opening
 * the create editor directly. api + CreateAutomationDialog mocked.
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { DiscoveredAutomation } from "../shared/automation-types.js";
import { encodeFolderPath } from "../client/folder-encoding.js";

const { listAutomations } = vi.hoisted(() => ({
  listAutomations: vi.fn(async (_cwd?: string): Promise<DiscoveredAutomation[]> => []),
}));
vi.mock("../client/api.js", () => ({ listAutomations }));

const { setLocation } = vi.hoisted(() => ({ setLocation: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));

vi.mock("../client/CreateAutomationDialog.js", () => ({
  CreateAutomationDialog: () => <div data-testid="create-automation-dialog" />,
}));

import { FolderAutomationSection } from "../client/FolderAutomationSection.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FolderAutomationSection", () => {
  it("renders OpenSpec-parity markup: uppercase title, refresh, + New chip", async () => {
    listAutomations.mockResolvedValueOnce([
      { name: "a", scope: "folder", dir: "/r/.pi/automation/a", valid: true },
      { name: "b", scope: "global", dir: "~/.pi/automation/b", valid: true },
    ]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/r" }} />);
    const board = await waitFor(() => getByTestId("folder-automation-open-board"));
    expect(board.textContent).toContain("Automations (2)");
    expect(board.className).toContain("uppercase");
    expect(getByTestId("folder-automation-refresh")).toBeTruthy();
    expect(getByTestId("folder-automation-new-btn").textContent).toContain("+ New");
  });

  it("still renders (count 0) when the folder has no automations, as the create entry point", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/empty" }} />);
    await waitFor(() => expect(getByTestId("folder-automation-open-board").textContent).toContain("Automations (0)"));
  });

  it("navigates to the shell-overlay board /folder/<enc>/automations", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/r" }} />);
    const board = await waitFor(() => getByTestId("folder-automation-open-board"));
    fireEvent.click(board);
    expect(setLocation).toHaveBeenCalledWith(`/folder/${encodeFolderPath("/r")}/automations`);
  });

  it("opens the create editor directly from + New without navigating", async () => {
    listAutomations.mockResolvedValueOnce([]);
    const { getByTestId } = render(<FolderAutomationSection folder={{ cwd: "/r" }} />);
    const newBtn = await waitFor(() => getByTestId("folder-automation-new-btn"));
    fireEvent.click(newBtn);
    expect(getByTestId("create-automation-dialog")).toBeTruthy();
    expect(setLocation).not.toHaveBeenCalled();
  });
});
