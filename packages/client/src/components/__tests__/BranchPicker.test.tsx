import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { BranchPicker } from "../worktree/BranchPicker.js";

const mockFetchBranches = vi.fn();

vi.mock("../../lib/git/git-api.js", () => ({
  fetchBranches: (...args: any[]) => mockFetchBranches(...args),
}));

afterEach(() => cleanup());

const branches = [
  { name: "main", isRemote: false, isCurrent: true },
  { name: "develop", isRemote: false, isCurrent: false },
  { name: "feature/ui", isRemote: false, isCurrent: false },
  { name: "origin/fix-bug", isRemote: true, isCurrent: false },
];

describe("BranchPicker", () => {
  beforeEach(() => {
    mockFetchBranches.mockResolvedValue({
      current: "main",
      detached: false,
      branches,
    });
  });

  it("renders branches after loading", async () => {
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
    expect(screen.getByText("develop")).toBeTruthy();
    expect(screen.getByText("feature/ui")).toBeTruthy();
    expect(screen.getByText("origin/fix-bug")).toBeTruthy();
  });

  it("shows current branch marker", async () => {
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
    expect(screen.getByText("●")).toBeTruthy();
  });

  it("filters branches by text", async () => {
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());

    const input = screen.getByPlaceholderText("Filter branches…");
    fireEvent.change(input, { target: { value: "feat" } });

    expect(screen.getByText("feature/ui")).toBeTruthy();
    expect(screen.queryByText("main")).toBeNull();
    expect(screen.queryByText("develop")).toBeNull();
  });

  it("shows remote section separator", async () => {
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());
    expect(screen.getByText("Remote")).toBeTruthy();
  });

  it("does not call onSelect when clicking current branch", async () => {
    const onSelect = vi.fn();
    render(<BranchPicker cwd="/test" onSelect={onSelect} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());

    fireEvent.click(screen.getByText("main"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelect when clicking a non-current branch", async () => {
    const onSelect = vi.fn();
    render(<BranchPicker cwd="/test" onSelect={onSelect} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());

    fireEvent.click(screen.getByText("develop"));
    expect(onSelect).toHaveBeenCalledWith("develop");
  });

  it("calls onCancel on Escape", async () => {
    const onCancel = vi.fn();
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());

    const input = screen.getByPlaceholderText("Filter branches…");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("navigates with arrow keys and selects with Enter", async () => {
    const onSelect = vi.fn();
    render(<BranchPicker cwd="/test" onSelect={onSelect} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("main")).toBeTruthy());

    const input = screen.getByPlaceholderText("Filter branches…");
    // First ArrowDown should highlight first selectable (develop, since main is current)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("develop");
  });

  it("shows error message on fetch failure", async () => {
    mockFetchBranches.mockRejectedValue(new Error("network error"));
    render(<BranchPicker cwd="/test" onSelect={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("network error")).toBeTruthy());
  });
});
