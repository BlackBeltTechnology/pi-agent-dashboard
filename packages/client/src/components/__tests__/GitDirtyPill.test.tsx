import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { GitDirtyPill } from "../worktree/GitDirtyPill.js";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

const mk = (o: Partial<GitStatus>): GitStatus => ({
  dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0, ...o,
});

describe("GitDirtyPill", () => {
  it("renders nothing when status is absent", () => {
    const { container } = render(<GitDirtyPill status={undefined} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when clean and in sync", () => {
    const { container } = render(<GitDirtyPill status={mk({})} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the dirty count", () => {
    render(<GitDirtyPill status={mk({ dirtyCount: 5 })} onClick={() => {}} />);
    expect(screen.getByTestId("git-dirty-count").textContent).toContain("5");
  });

  it("shows ahead/behind chips only when non-zero", () => {
    render(<GitDirtyPill status={mk({ dirtyCount: 1, ahead: 2, behind: 1 })} onClick={() => {}} />);
    expect(screen.getByTestId("git-ahead").textContent).toBe("↑2");
    expect(screen.getByTestId("git-behind").textContent).toBe("↓1");
  });

  it("omits drift chips when ahead/behind are zero", () => {
    render(<GitDirtyPill status={mk({ dirtyCount: 1 })} onClick={() => {}} />);
    expect(screen.queryByTestId("git-ahead")).toBeNull();
    expect(screen.queryByTestId("git-behind")).toBeNull();
  });

  it("is a button that opens the dialog", () => {
    const onClick = vi.fn();
    render(<GitDirtyPill status={mk({ dirtyCount: 3 })} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("git-dirty-pill"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
