/**
 * Tests for the concurrent worktree-init stack (design E2).
 *
 * Pins: hidden for < 2 runs; visible + summarizing for concurrent runs;
 * failed row holds it open with a Dismiss action.
 *
 * See change: friendlier-worktree-init.
 */

import { mdiCheckCircleOutline } from "@mdi/js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetInitBusForTests } from "../../lib/git/worktree-init-bus.js";
import { initStore } from "../../lib/git/worktree-init-store.js";
import { WorktreeInitStack } from "../worktree/WorktreeInitStack.js";

beforeEach(() => { initStore.__resetForTests(); __resetInitBusForTests(); });
afterEach(() => { cleanup(); initStore.__resetForTests(); __resetInitBusForTests(); });

describe("WorktreeInitStack", () => {
  it("renders nothing for a single run", () => {
    act(() => initStore.startRun("/w/only"));
    render(<WorktreeInitStack />);
    expect(screen.queryByTestId("worktree-init-stack")).toBeNull();
  });

  it("stacks concurrent runs with a summary header", async () => {
    render(<WorktreeInitStack />);
    act(() => { initStore.startRun("/w/add-search"); initStore.startRun("/w/fix-auth"); });
    await waitFor(() => screen.getByTestId("worktree-init-stack"));
    expect(screen.getByTestId("worktree-init-stack").textContent).toContain("Initializing 2 worktrees");
    expect(screen.getByText("add-search")).toBeTruthy();
    expect(screen.getByText("fix-auth")).toBeTruthy();
  });

  it("a failed row holds the surface open with Dismiss", async () => {
    render(<WorktreeInitStack />);
    act(() => {
      initStore.startRun("/w/add-search");
      initStore.startRun("/w/refactor-db");
      initStore.markFailed("/w/refactor-db", "script_nonzero_exit", "exit 1");
    });
    await waitFor(() => screen.getByTestId("worktree-init-stack"));
    const dismiss = screen.getByTestId("worktree-init-stack-dismiss");
    act(() => fireEvent.click(dismiss));
    expect(initStore.getRun("/w/refactor-db")).toBeUndefined();
  });
});

describe("WorktreeInitStack colour roles (fix-folder-card-pill-contrast #E20)", () => {
  async function renderThree() {
    const utils = render(<WorktreeInitStack />);
    act(() => {
      initStore.startRun("/w/running-one");
      initStore.startRun("/w/done-one");
      initStore.markDone("/w/done-one");
      initStore.startRun("/w/failed-one");
      initStore.markFailed("/w/failed-one", "script_nonzero_exit", "exit 1");
    });
    const stack = await waitFor(() => screen.getByTestId("worktree-init-stack"));
    return { ...utils, stack };
  }
  const rowOf = (stack: HTMLElement, name: string) =>
    Array.from(stack.querySelectorAll("div")).find((d) => d.className.includes("border-b") && d.textContent?.includes(name)) as HTMLElement;

  it("failed row is --severity-error, code uses its fg", async () => {
    const { stack } = await renderThree();
    const row = rowOf(stack, "failed-one");
    expect(row.className).toContain("bg-[var(--severity-error-bg)]");
    const code = Array.from(row.querySelectorAll("span")).find((s) => s.textContent === "script_nonzero_exit");
    expect(code?.className).toContain("text-[var(--severity-error-fg)]");
    expect(code?.className).toContain("text-[11px]");
  });

  it("done row is --accent-green-text with an MDI glyph and no ✓/✕ text", async () => {
    const { stack } = await renderThree();
    const row = rowOf(stack, "done-one");
    expect(row.innerHTML).toContain("text-[var(--accent-green-text)]");
    expect(row.querySelector("svg path")?.getAttribute("d")).toBe(mdiCheckCircleOutline);
    expect(stack.textContent).not.toMatch(/[✓✕]/);
  });

  it("Dismiss is neutral 12px; meta is --text-secondary; shadow uses --shadow-card; no palette class", async () => {
    const { stack } = await renderThree();
    const dismiss = screen.getByTestId("worktree-init-stack-dismiss");
    expect(dismiss.className).toContain("text-[var(--text-primary)]");
    expect(dismiss.className).toContain("border-[var(--border-secondary)]");
    expect(dismiss.className).toContain("text-[12px]");
    expect(stack.className).toContain("var(--shadow-card)");
    expect(stack.className).not.toContain("rgba(");
    expect(stack.innerHTML).not.toContain("--text-muted");
    expect(stack.outerHTML).not.toMatch(/(?:text|border|bg)-(?:amber|green|red|blue)-\d{3}/);
    expect(stack.innerHTML).toContain("text-[var(--text-secondary)]");
  });
});
