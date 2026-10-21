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

import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiReplay } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeInitHook } from "../../lib/git/git-api.js";
import { __resetInitBusForTests, dispatchInitEvent } from "../../lib/git/worktree-init-bus.js";
import { type ClientInitRun, initStore } from "../../lib/git/worktree-init-store.js";
import { WorktreeInitButton } from "../worktree/WorktreeInitButton.js";
import { WorktreeInitChip } from "../worktree/WorktreeInitChip.js";

const { fetchWorktreeInitStatus, runWorktreeInit } = vi.hoisted(() => ({
  fetchWorktreeInitStatus: vi.fn(),
  runWorktreeInit: vi.fn(),
}));

vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
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

  it("labels the control 'Review & trust' when the hook is untrusted", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, needsInit: false, trusted: false });
    render(<WorktreeInitButton cwd="/repo" />);
    await waitFor(() => screen.getByTestId("worktree-init-btn"));
    expect(screen.getByTestId("worktree-init-btn").textContent).toBe("Review & trust");
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

/**
 * `WorktreeInitChip` is colour-free: it inherits the hosting banner's
 * `--severity-*-fg` (change: fix-folder-card-pill-contrast, test-plan #E17).
 */
describe("WorktreeInitChip — inherited colour", () => {
  const base: ClientInitRun = { cwd: "/repo", phase: "running", startedAt: Date.now() };
  const running: ClientInitRun = { ...base, lastLine: "added 412 packages", logTail: "$ npm ci\nadded 412 packages" };
  const done: ClientInitRun = { ...base, phase: "done" };
  const failed: ClientInitRun = {
    ...base,
    phase: "failed",
    code: "script_nonzero_exit",
    message: "script_nonzero_exit",
    stderr: "boom: exit 3",
  };

  const PALETTE = /(?:^|[\s:])(?:text|bg|border|from|via|to|ring|fill|stroke)-(?:amber|green|red|blue|yellow|orange|emerald|purple|indigo)-\d{2,3}/;
  const paths = (el: Element) => [...el.querySelectorAll("svg path")].map((p) => p.getAttribute("d"));

  it.each([
    ["running", running],
    ["done", done],
    ["failed", failed],
  ])("%s: no palette class and no --text-muted / --text-tertiary", (_n, run) => {
    const { container } = render(<WorktreeInitChip run={run} onRetry={() => {}} />);
    const classes = [...container.querySelectorAll("[class]")].map((e) => e.getAttribute("class") ?? "").join(" ");
    expect(PALETTE.test(classes)).toBe(false);
    expect(classes).not.toContain("--text-muted");
    expect(classes).not.toContain("--text-tertiary");
  });

  it("running: spinner arc and progress bar paint currentColor; ghost line is mono 11px", () => {
    const { container } = render(<WorktreeInitChip run={running} />);
    expect(container.querySelector(".animate-spin")?.className).toContain("border-t-current");
    expect(container.querySelector("i")?.className).toContain("via-current");
    const ghost = screen.getByTestId("worktree-init-ghost");
    expect(ghost.className).toContain("text-[11px]");
    expect(ghost.className).toContain("font-mono");
  });

  it("done: check glyph is mdiCheckCircleOutline, no ✓ text", () => {
    const { container } = render(<WorktreeInitChip run={done} />);
    expect(paths(container)).toContain(mdiCheckCircleOutline);
    expect(container.textContent).not.toContain("✓");
    expect(container.textContent).toContain("Initialized");
  });

  it("failed: label and code on separate block elements; Retry is border-current 12px with mdiReplay", () => {
    const { container } = render(<WorktreeInitChip run={failed} onRetry={() => {}} />);
    const label = screen.getByText("Init failed");
    const code = screen.getByText("script_nonzero_exit");
    expect(label.closest("div")).not.toBe(code.closest("div"));
    expect(label.closest("div")?.contains(code)).toBe(false);
    expect(code.closest("div")?.className).toContain("text-[11px]");
    expect(paths(container)).toContain(mdiAlertCircleOutline);
    expect(container.textContent).not.toContain("✕");
    const retry = screen.getByTestId("worktree-init-retry");
    expect(retry.className).toContain("border-current");
    expect(retry.className).toContain("text-[12px]");
    expect(paths(retry)).toContain(mdiReplay);
    expect(retry.textContent).not.toContain("↻");
    // Retry sits on its own row, outside the summary block.
    expect(screen.getByTestId("worktree-init-error").contains(retry)).toBe(false);
  });

  it("opened log <pre> keeps code colours: --text-secondary on --bg-code, 11px; toggle inherits at 11px", () => {
    render(<WorktreeInitChip run={failed} />);
    const log = screen.getByTestId("worktree-init-log");
    const pre = log.querySelector("pre");
    expect(pre?.className).toContain("text-[var(--text-secondary)]");
    expect(pre?.className).toContain("bg-[var(--bg-code)]");
    expect(pre?.className).toContain("text-[11px]");
    const summary = log.querySelector("summary");
    expect(summary?.className).toContain("text-[11px]");
    expect(summary?.className).not.toContain("--text-");
  });
});
