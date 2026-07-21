/**
 * Tests for the concurrent worktree-init stack (design E2).
 *
 * Pins: hidden for < 2 runs; visible + summarizing for concurrent runs;
 * failed row holds it open with a Dismiss action.
 *
 * See change: friendlier-worktree-init.
 */
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
