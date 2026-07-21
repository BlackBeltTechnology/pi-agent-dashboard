/**
 * Tests for the elevated FolderSpawnButtons stack.
 * See change: elevate-folder-spawn-buttons.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FolderSpawnButtons } from "../folder/FolderSpawnButtons.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderButtons(
  overrides: Partial<React.ComponentProps<typeof FolderSpawnButtons>> = {},
) {
  const props: React.ComponentProps<typeof FolderSpawnButtons> = {
    showWorktree: false,
    onSpawnSession: () => {},
    ...overrides,
  };
  return render(<FolderSpawnButtons {...props} />);
}

describe("FolderSpawnButtons", () => {
  it("always renders the +New Session button", () => {
    renderButtons();
    expect(screen.getByTestId("folder-spawn-session-btn")).toBeTruthy();
  });

  it("hides the +New Worktree button when showWorktree is false", () => {
    renderButtons({ showWorktree: false });
    expect(screen.queryByTestId("folder-spawn-worktree-btn")).toBeNull();
  });

  it("renders the +New Worktree button when showWorktree is true", () => {
    renderButtons({ showWorktree: true, onSpawnWorktree: () => {} });
    expect(screen.getByTestId("folder-spawn-worktree-btn")).toBeTruthy();
  });

  it("disables the session button when spawningDisabled", () => {
    renderButtons({ spawningDisabled: true });
    expect(screen.getByTestId("folder-spawn-session-btn").hasAttribute("disabled")).toBe(true);
  });

  it("enables the session button when not spawning", () => {
    renderButtons({ spawningDisabled: false });
    expect(screen.getByTestId("folder-spawn-session-btn").hasAttribute("disabled")).toBe(false);
  });

  it("fires onSpawnSession on click", () => {
    const onSpawnSession = vi.fn();
    renderButtons({ onSpawnSession });
    fireEvent.click(screen.getByTestId("folder-spawn-session-btn"));
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
  });

  it("fires onSpawnWorktree on click", () => {
    const onSpawnWorktree = vi.fn();
    renderButtons({ showWorktree: true, onSpawnWorktree });
    fireEvent.click(screen.getByTestId("folder-spawn-worktree-btn"));
    expect(onSpawnWorktree).toHaveBeenCalledTimes(1);
  });
});
