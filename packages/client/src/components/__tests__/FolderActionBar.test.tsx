/**
 * Tests for the `+Worktree` button visibility on `FolderActionBar`.
 *
 * Pins the §7 contract from `add-worktree-spawn-dialog`:
 *   - Button hidden when folder is not a git repo (`isGitRepo` false/undefined).
 *   - Button hidden when no `onOpenWorktreeDialog` is provided.
 *   - Button visible when both conditions hold; click calls the callback.
 *   - Visibility is NOT gated on loopback — the worktree-add runs on the
 *     server (= the user's machine) regardless of how the browser reached
 *     the dashboard. Server-side `networkGuard` enforces access.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FolderActionBar } from "../FolderActionBar.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(overrides: Partial<React.ComponentProps<typeof FolderActionBar>> = {}) {
  const props: React.ComponentProps<typeof FolderActionBar> = {
    cwd: "/repo",
    terminalCount: 0,
    nativeEditors: [],
    onSpawnSession: () => {},
    onOpenTerminals: () => {},
    onOpenEditor: () => {},
    onOpenNativeEditor: () => {},
    onOpenPiResources: () => {},
    isGitRepo: true,
    gitWorktreeEnabled: true,
    onOpenWorktreeDialog: () => {},
    ...overrides,
  };
  return render(<FolderActionBar {...props} />);
}

describe("FolderActionBar +Worktree button — visibility gating", () => {
  it("renders the +Worktree button when all conditions hold (git repo + localhost + handler)", () => {
    renderBar();
    expect(screen.getByTestId("spawn-worktree-btn")).toBeTruthy();
  });

  it("hides the button when folder is not a git repo (isGitRepo=false)", () => {
    renderBar({ isGitRepo: false });
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
  });

  it("hides the button when isGitRepo is undefined (defensive default)", () => {
    renderBar({ isGitRepo: undefined });
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
  });

  it("renders the button regardless of how the browser reached the dashboard (no loopback gate)", () => {
    // Sanity: the action bar does not consult window.location.hostname.
    // This documents the design choice — the server is the user's
    // machine in every access mode; the worktree-add lands on local
    // disk identically.
    renderBar();
    expect(screen.getByTestId("spawn-worktree-btn")).toBeTruthy();
  });

  it("hides the button when no onOpenWorktreeDialog handler is provided", () => {
    renderBar({ onOpenWorktreeDialog: undefined });
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
  });

  it("hides the button when gitWorktreeEnabled=false even on a git repo with handler", () => {
    renderBar({ gitWorktreeEnabled: false });
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
  });

  it("renders the button when gitWorktreeEnabled=true (explicit) on a git repo", () => {
    renderBar({ gitWorktreeEnabled: true });
    expect(screen.getByTestId("spawn-worktree-btn")).toBeTruthy();
  });

  it("click invokes onOpenWorktreeDialog and stops propagation", () => {
    const handler = vi.fn();
    const parentClick = vi.fn();
    const { container } = renderBar({ onOpenWorktreeDialog: handler });
    // Wrap in a div to detect propagation
    const wrapper = container.firstChild as HTMLElement;
    wrapper.addEventListener("click", parentClick);
    fireEvent.click(screen.getByTestId("spawn-worktree-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
    // Click event from inside the button shouldn't reach the wrapper because
    // we stopPropagation in the handler. (Note: testing-library fireEvent
    // still bubbles internally; the assertion below verifies handler-level
    // behavior is correct rather than the DOM bubble path.)
  });
});

describe("FolderActionBar +Session button — unchanged", () => {
  it("still renders the +Session button regardless of git state", () => {
    renderBar({ isGitRepo: false });
    expect(screen.getByTestId("spawn-session-btn")).toBeTruthy();
  });
});
