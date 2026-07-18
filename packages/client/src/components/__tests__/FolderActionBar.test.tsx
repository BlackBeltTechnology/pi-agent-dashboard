/**
 * Tests for the trimmed `FolderActionBar`.
 *
 * After change `elevate-folder-spawn-buttons`, the `+Session` and `+Worktree`
 * buttons are relocated to the elevated `FolderSpawnButtons` stack and SHALL
 * NOT appear in the action bar. This file pins their absence.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitStatus } from "../../lib/git/git-api.js";
import { FolderActionBar } from "../folder/FolderActionBar.js";

const { fetchWorktreeInitStatus } = vi.hoisted(() => ({ fetchWorktreeInitStatus: vi.fn() }));
vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return { ...actual, fetchWorktreeInitStatus };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default fail-open probe so the shared init-status hook never rejects.
  fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false });
});

function renderBar(overrides: Partial<React.ComponentProps<typeof FolderActionBar>> = {}) {
  const props: React.ComponentProps<typeof FolderActionBar> = {
    cwd: "/repo",
    terminalCount: 0,
    onOpenTerminals: () => {},
    onOpenEditor: () => {},
    onOpenPiResources: () => {},
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

  it("still renders the Terminals button", () => {
    renderBar({ terminalCount: 3 });
    expect(screen.getByText(/Terminals\(3\)/)).toBeTruthy();
  });
});

describe("FolderActionBar — init controls per state (single shared probe)", () => {
  const setStatus = (s: WorktreeInitStatus) => fetchWorktreeInitStatus.mockResolvedValue(s);

  it("state ① (unconfigured) shows 'Set up project', not the hook runner", async () => {
    setStatus({ hasHook: false, configured: false });
    const onInitializeProject = vi.fn();
    renderBar({ onInitializeProject });
    await waitFor(() => screen.getByTestId("project-init-btn"));
    expect(screen.getByTestId("project-init-btn").textContent).toContain("Set up project");
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
    fireEvent.click(screen.getByTestId("project-init-btn"));
    expect(onInitializeProject).toHaveBeenCalledWith("/repo");
  });

  it("state ② (hook needs init) shows the amber 'Initialize' hook runner, not scaffold", async () => {
    setStatus({ hasHook: true, needsInit: true, trusted: true });
    renderBar({ onInitializeProject: vi.fn() });
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    expect(screen.getByTestId("worktree-init-btn").textContent).toContain("Initialize");
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
  });

  it("state ③ (configured, no hook) shows neither init control", async () => {
    setStatus({ hasHook: false, configured: true });
    renderBar({ onInitializeProject: vi.fn() });
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });

  it("probes init-status once for the row (single shared fetch)", async () => {
    setStatus({ hasHook: false, configured: true });
    renderBar({ onInitializeProject: vi.fn() });
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);
  });
});
