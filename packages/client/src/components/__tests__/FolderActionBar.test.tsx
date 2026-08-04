/**
 * Tests for the cleanup-only `FolderActionBar`.
 *
 * After change `elevate-folder-spawn-buttons`, the `+Session` and `+Worktree`
 * buttons are relocated to the folder tools menu and SHALL NOT appear in the
 * action bar. This file pins their absence.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionBar } from "../folder/FolderActionBar.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderBar(overrides: Partial<React.ComponentProps<typeof FolderActionBar>> = {}) {
  const props: React.ComponentProps<typeof FolderActionBar> = {
    ...overrides,
  };
  return render(<FolderActionBar {...props} />);
}

describe("FolderActionBar — spawn buttons relocated", () => {
  it("does NOT render the +Session button in the bar", () => {
    renderBar();
    expect(screen.queryByTestId("spawn-session-btn")).toBeNull();
    expect(screen.queryByTestId("folder-spawn-session-btn")).toBeNull();
  });

  it("does NOT render the +Worktree button in the bar", () => {
    renderBar();
    expect(screen.queryByTestId("spawn-worktree-btn")).toBeNull();
    expect(screen.queryByTestId("folder-spawn-worktree-btn")).toBeNull();
  });

  it("does NOT render the Terminals button (removed — reachable from Directory home / ChatView)", () => {
    renderBar();
    expect(screen.queryByText(/Terminals\(/)).toBeNull();
  });

  it("does NOT render the Editor button (removed — reachable from Directory home / ChatView)", () => {
    renderBar();
    expect(screen.queryByText(/Editor/)).toBeNull();
  });
});
