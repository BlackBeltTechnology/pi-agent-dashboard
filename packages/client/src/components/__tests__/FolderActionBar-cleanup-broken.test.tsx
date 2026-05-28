/**
 * Tests for the `Clean up broken (N)` button on FolderActionBar.
 *
 * See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FolderActionBar } from "../FolderActionBar.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderBar(over: Partial<React.ComponentProps<typeof FolderActionBar>> = {}) {
  const props: React.ComponentProps<typeof FolderActionBar> = {
    cwd: "/repo",
    terminalCount: 0,
    nativeEditors: [],
    onSpawnSession: () => {},
    onOpenTerminals: () => {},
    onOpenEditor: () => {},
    onOpenNativeEditor: () => {},
    onOpenPiResources: () => {},
    gitWorktreeEnabled: true,
    ...over,
  };
  return render(<FolderActionBar {...props} />);
}

describe("FolderActionBar — Clean up broken", () => {
  it("hides the button when count is 0", () => {
    renderBar({ brokenSessionCount: 0, onCleanUpBroken: () => {} });
    expect(screen.queryByTestId("folder-cleanup-broken-btn")).toBeNull();
  });
  it("hides the button when handler is missing", () => {
    renderBar({ brokenSessionCount: 3 });
    expect(screen.queryByTestId("folder-cleanup-broken-btn")).toBeNull();
  });
  it("renders the button with count when N > 0 and handler provided", () => {
    renderBar({ brokenSessionCount: 3, onCleanUpBroken: () => {} });
    expect(screen.getByTestId("folder-cleanup-broken-btn").textContent).toContain("3");
  });
  it("clicking opens a ConfirmDialog; clicking confirm fires onCleanUpBroken", () => {
    const onCleanUpBroken = vi.fn();
    renderBar({ brokenSessionCount: 2, onCleanUpBroken });
    fireEvent.click(screen.getByTestId("folder-cleanup-broken-btn"));
    expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("confirm-ok"));
    expect(onCleanUpBroken).toHaveBeenCalledTimes(1);
  });
});
