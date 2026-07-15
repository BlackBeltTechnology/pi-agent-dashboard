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

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitHook } from "../../lib/git-api.js";
import { __resetInitBusForTests, dispatchInitEvent } from "../../lib/worktree-init-bus.js";
import { initStore } from "../../lib/worktree-init-store.js";
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

afterEach(() => { cleanup(); vi.clearAllMocks(); initStore.__resetForTests(); __resetInitBusForTests(); });

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

  it("untrusted hook → two-action trust dialog; 'Always trust' re-runs with confirmHash + project scope", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, untrusted: true, hook, hash: "abc123" })
      .mockResolvedValueOnce({ ok: true, ran: true, durationMs: 10 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));

    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    // Trust dialog names the gate and offers both affirmative actions.
    await waitFor(() => screen.getByText(/test ! -d node_modules/));
    expect(screen.getByTestId("worktree-init-trust-session")).toBeTruthy();
    expect(screen.getByTestId("worktree-init-trust-always")).toBeTruthy();
    expect(runWorktreeInit).toHaveBeenCalledTimes(1);
    expect(runWorktreeInit.mock.calls[0][0].confirmHash).toBeUndefined();

    // "Always trust" → re-run carries confirmHash + scope "project".
    fireEvent.click(screen.getByTestId("worktree-init-trust-always"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0].confirmHash).toBe("abc123");
    expect(runWorktreeInit.mock.calls[1][0].scope).toBe("project");
  });

  it("untrusted hook → 'Trust until dashboard restarts' re-runs with confirmHash + session scope", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: false });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, untrusted: true, hook, hash: "abc123" })
      .mockResolvedValueOnce({ ok: true, ran: true, durationMs: 10 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-trust-session"));
    fireEvent.click(screen.getByTestId("worktree-init-trust-session"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
    expect(runWorktreeInit.mock.calls[1][0].confirmHash).toBe("abc123");
    expect(runWorktreeInit.mock.calls[1][0].scope).toBe("session");
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

  it("running renders a status chip with opt-in log (not a raw <pre>)", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    // Keep the run in flight so the chip stays visible.
    runWorktreeInit.mockReturnValue(new Promise(() => {}));
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-chip"));
    // Stream a progress line by the run's cwd (survives refresh / cross-tab).
    act(() => dispatchInitEvent({ type: "worktree_init_progress", requestId: "", cwd: "/repo", line: "$ npm ci\nadded 412 packages" }));
    await waitFor(() => expect(screen.getByTestId("worktree-init-ghost").textContent).toContain("added 412 packages"));
    // Full log is opt-in behind a collapsed disclosure, not an inline pre.
    expect(screen.getByTestId("worktree-init-log").hasAttribute("open")).toBe(false);
    expect(screen.queryByTestId("worktree-init-tail")).toBeNull();
  });

  it("failure chip is sticky + retryable and re-runs on Retry", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: true, trusted: true });
    runWorktreeInit
      .mockResolvedValueOnce({ ok: false, code: "init_failed", error: "boom", stderr: "trace tail" })
      .mockReturnValueOnce(new Promise(() => {}));
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    await waitFor(() => screen.getByTestId("worktree-init-error"));
    // Retry re-issues the run.
    fireEvent.click(screen.getByTestId("worktree-init-retry"));
    await waitFor(() => expect(runWorktreeInit).toHaveBeenCalledTimes(2));
  });

  it("success flashes a confirmation before collapsing", async () => {
    fetchWorktreeInitStatus
      .mockResolvedValueOnce({ hasHook: true, needsInit: true, trusted: true })
      .mockResolvedValue({ hasHook: true, needsInit: false, trusted: true });
    runWorktreeInit.mockResolvedValue({ ok: true, ran: true, durationMs: 12 });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    fireEvent.click(screen.getByTestId("worktree-init-btn"));
    // Green flash confirms success before the store collapses it.
    await waitFor(() => expect(screen.getByTestId("worktree-init-chip").textContent).toContain("Initialized"));
  });

  it("labels the control 'Review & trust changes' when the hook was edited", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: false, trusted: false });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    expect(screen.getByTestId("worktree-init-btn").textContent).toContain("Review & trust changes");
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
