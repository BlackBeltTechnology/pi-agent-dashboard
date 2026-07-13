/**
 * Component tests for `WorktreeInitButton`.
 *
 * Pins the folder-action-bar capability:
 *  - button shown iff hasHook && needsInit
 *  - untrusted hook → trust-confirm dialog gates the run
 *  - failure renders a card with the stderr/log tail
 *  - success re-fetches init-status → button disappears
 *
 * See change: generalize-worktree-init-hook.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitHook } from "../../lib/git-api.js";
import { WorktreeInitButton } from "../WorktreeInitButton.js";

const { fetchWorktreeInitStatus, runWorktreeInit } = vi.hoisted(() => ({
  fetchWorktreeInitStatus: vi.fn(),
  runWorktreeInit: vi.fn(),
}));

vi.mock("../../lib/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git-api.js")>("../../lib/git-api.js");
  return { ...actual, fetchWorktreeInitStatus, runWorktreeInit };
});

const hook: WorktreeInitHook = { gate: "test ! -d node_modules", run: { type: "script", command: "npm ci" } };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("WorktreeInitButton", () => {
  it("shows the button when needsInit is true", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    expect(screen.getByTestId("worktree-init-btn").textContent).toContain("Initialize");
  });

  it("shows the button when the hook is present but untrusted (gate not yet run)", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, trusted: false });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
  });

  it("hides the button when needsInit is false", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: false, trusted: true });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });

  it("hides the button when the repo declares no hook (state ①)", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false, configured: false });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });

  it("hides the button for a configured project with no hook (state ③)", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false, configured: true });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });

  it("untrusted hook → trust dialog gates the run, then re-runs with confirmHash", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, untrusted: true, hook, hash: "abc123" })
      .mockResolvedValueOnce({ ok: true, ran: true, durationMs: 10 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));

    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    // Trust dialog names the gate.
    await waitFor(() => screen.getByText(/test ! -d node_modules/));
    expect(runWorktreeInit).toHaveBeenCalledTimes(1);
    expect(runWorktreeInit.mock.calls[0][0].confirmHash).toBeUndefined();

    // Confirm → re-run carries confirmHash.
    fireEvent.click(screen.getByText("Run"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0].confirmHash).toBe("abc123");
  });

  it("renders a failure card when the run fails", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: false, code: "init_failed", error: "boom", stderr: "trace tail" });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-error"));
    expect(screen.getByTestId("worktree-init-error").textContent).toContain("init_failed");
    expect(screen.getByText("trace tail")).toBeTruthy();
  });

  it("success re-fetches init-status and the button disappears", async () => {
    fetchWorktreeInitStatus
      .mockResolvedValueOnce({ hasHook: true, needsInit: true, trusted: true })
      .mockResolvedValue({ hasHook: true, needsInit: false, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: true, ran: true, durationMs: 10 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => expect(screen.queryByTestId("worktree-init-btn")).toBeNull());
  });

  // The no-hook / scaffold branch moved to `ProjectInitButton`
  // (change: distinguish-initialize-actions). `WorktreeInitButton` is now
  // hook-only and never renders a `project-init-btn`.
  it("never renders a project-init button, even on a no-hook row", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false, configured: false });
    render(<WorktreeInitButton cwd="/bare" />);
    await waitFor(() => expect(fetchWorktreeInitStatus).toHaveBeenCalled());
    expect(screen.queryByTestId("project-init-btn")).toBeNull();
    expect(screen.queryByTestId("worktree-init-btn")).toBeNull();
  });
});
