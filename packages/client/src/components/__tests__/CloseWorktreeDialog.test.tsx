/**
 * Tests for CloseWorktreeDialog. See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CloseWorktreeDialog } from "../worktree/CloseWorktreeDialog.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const removeWorktreeMock = vi.fn();
vi.mock("../../lib/git/git-api.js", () => ({
  removeWorktree: (args: any) => removeWorktreeMock(args),
}));

afterEach(() => {
  cleanup();
  removeWorktreeMock.mockReset();
});

function renderDialog(over: Partial<React.ComponentProps<typeof CloseWorktreeDialog>> = {}) {
  const props: React.ComponentProps<typeof CloseWorktreeDialog> = {
    cwd: "/repo/.worktrees/x",
    allSessions: [],
    onShutdownSession: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { props, ...render(<CloseWorktreeDialog {...props} />) };
}

describe("CloseWorktreeDialog", () => {
  it("renders the dialog with cwd shown", () => {
    renderDialog();
    expect(screen.getByTestId("close-worktree-dialog")).toBeTruthy();
    expect(document.body.textContent).toContain("/repo/.worktrees/x");
  });

  it("on active_sessions response, shows the session list + 'End N' button", async () => {
    const sessions: DashboardSession[] = [
      { id: "a", cwd: "/repo/.worktrees/x", source: "dashboard", status: "active", startedAt: 1, name: "Session A" } as DashboardSession,
      { id: "b", cwd: "/repo/.worktrees/x", source: "dashboard", status: "active", startedAt: 2, name: "Session B" } as DashboardSession,
    ];
    removeWorktreeMock.mockResolvedValueOnce({
      ok: false, code: "active_sessions", error: "active_sessions", data: { sessionIds: ["a", "b"] },
    });
    renderDialog({ allSessions: sessions });
    fireEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(screen.getByTestId("close-active-sessions")).toBeTruthy());
    expect(screen.getByTestId("close-active-session-a").textContent).toContain("Session A");
    expect(screen.getByTestId("close-end-sessions").textContent).toMatch(/End 2 sessions/i);
  });

  it("clicking End sessions fires onShutdownSession for each id then retries with force", async () => {
    vi.useFakeTimers();
    try {
      removeWorktreeMock
        .mockResolvedValueOnce({ ok: false, code: "active_sessions", error: "x", data: { sessionIds: ["a", "b"] } })
        .mockResolvedValueOnce({ ok: true });
      const onShutdownSession = vi.fn();
      renderDialog({ onShutdownSession });
      fireEvent.click(screen.getByTestId("close-confirm"));
      await vi.waitFor(() => expect(screen.getByTestId("close-end-sessions")).toBeTruthy());
      fireEvent.click(screen.getByTestId("close-end-sessions"));
      expect(onShutdownSession).toHaveBeenCalledWith("a");
      expect(onShutdownSession).toHaveBeenCalledWith("b");
      await vi.advanceTimersByTimeAsync(1000);
      expect(removeWorktreeMock).toHaveBeenLastCalledWith({ cwd: "/repo/.worktrees/x", force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("dirty_worktree response auto-ticks --force, surfaces hint, and next click sends force:true", async () => {
    removeWorktreeMock
      .mockResolvedValueOnce({ ok: false, code: "dirty_worktree", error: "dirty", stderr: "modified files" })
      .mockResolvedValueOnce({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(screen.getByTestId("close-error")).toBeTruthy());
    // Auto-ticked.
    const toggle = screen.getByTestId("close-force-toggle") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    // Hint visible.
    expect(screen.getByTestId("close-error").textContent).toMatch(/--force/);
    // Click Remove again — force is already true, no need to toggle.
    fireEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(removeWorktreeMock).toHaveBeenLastCalledWith({ cwd: "/repo/.worktrees/x", force: true }));
  });

  it("happy path: removeWorktree ok closes the dialog", async () => {
    removeWorktreeMock.mockResolvedValueOnce({ ok: true });
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    renderDialog({ onClose, onRemoved });
    fireEvent.click(screen.getByTestId("close-confirm"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onRemoved).toHaveBeenCalled();
  });
});
