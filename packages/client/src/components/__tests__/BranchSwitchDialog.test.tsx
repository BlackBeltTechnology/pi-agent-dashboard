import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { BranchSwitchDialog } from "../worktree/BranchSwitchDialog.js";

const mockFetchBranches = vi.fn();
const mockCheckoutBranch = vi.fn();
const mockStashPop = vi.fn();

vi.mock("../../lib/git/git-api.js", () => ({
  fetchBranches: (...args: any[]) => mockFetchBranches(...args),
  checkoutBranch: (...args: any[]) => mockCheckoutBranch(...args),
  stashPop: (...args: any[]) => mockStashPop(...args),
}));

afterEach(() => cleanup());

const branches = [
  { name: "main", isRemote: false, isCurrent: true },
  { name: "develop", isRemote: false, isCurrent: false },
];

describe("BranchSwitchDialog", () => {
  beforeEach(() => {
    mockFetchBranches.mockResolvedValue({
      current: "main",
      detached: false,
      branches,
    });
    mockCheckoutBranch.mockReset();
    mockStashPop.mockReset();
  });

  it("shows branch picker initially", async () => {
    render(<BranchSwitchDialog cwd="/test" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Switch Branch")).toBeTruthy());
    expect(screen.getByText("develop")).toBeTruthy();
  });

  it("clean checkout closes dialog", async () => {
    mockCheckoutBranch.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<BranchSwitchDialog cwd="/test" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());

    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCheckoutBranch).toHaveBeenCalledWith("/test", "develop", false);
  });

  it("dirty working tree shows stash confirmation", async () => {
    mockCheckoutBranch.mockResolvedValue({
      success: false,
      dirty: true,
      files: ["src/foo.ts", "src/bar.ts"],
    });
    render(<BranchSwitchDialog cwd="/test" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());

    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());
    expect(screen.getByText("src/foo.ts")).toBeTruthy();
    expect(screen.getByText("src/bar.ts")).toBeTruthy();
  });

  it("stash & switch then asks to pop", async () => {
    // First call: dirty. Second call (with stash): success + stashed
    mockCheckoutBranch
      .mockResolvedValueOnce({ success: false, dirty: true, files: ["x.ts"] })
      .mockResolvedValueOnce({ success: true, stashed: true });

    render(<BranchSwitchDialog cwd="/test" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());

    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());

    fireEvent.click(screen.getByText("Stash & Switch"));
    await waitFor(() => expect(screen.getByText(/Pop stash/)).toBeTruthy());
    expect(mockCheckoutBranch).toHaveBeenCalledWith("/test", "develop", true);
  });

  it("declining pop closes dialog", async () => {
    mockCheckoutBranch
      .mockResolvedValueOnce({ success: false, dirty: true, files: ["x.ts"] })
      .mockResolvedValueOnce({ success: true, stashed: true });
    const onClose = vi.fn();

    render(<BranchSwitchDialog cwd="/test" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());
    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());
    fireEvent.click(screen.getByText("Stash & Switch"));
    await waitFor(() => expect(screen.getByText(/Pop stash/)).toBeTruthy());

    fireEvent.click(screen.getByText("No, keep stashed"));
    expect(onClose).toHaveBeenCalled();
  });

  it("accepting pop calls stashPop and closes", async () => {
    mockCheckoutBranch
      .mockResolvedValueOnce({ success: false, dirty: true, files: ["x.ts"] })
      .mockResolvedValueOnce({ success: true, stashed: true });
    mockStashPop.mockResolvedValue({ conflicts: false });
    const onClose = vi.fn();

    render(<BranchSwitchDialog cwd="/test" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());
    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());
    fireEvent.click(screen.getByText("Stash & Switch"));
    await waitFor(() => expect(screen.getByText(/Pop stash/)).toBeTruthy());

    fireEvent.click(screen.getByText("Pop"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockStashPop).toHaveBeenCalledWith("/test");
  });

  it("shows error on pop with conflicts", async () => {
    mockCheckoutBranch
      .mockResolvedValueOnce({ success: false, dirty: true, files: ["x.ts"] })
      .mockResolvedValueOnce({ success: true, stashed: true });
    mockStashPop.mockResolvedValue({ conflicts: true });

    render(<BranchSwitchDialog cwd="/test" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());
    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());
    fireEvent.click(screen.getByText("Stash & Switch"));
    await waitFor(() => expect(screen.getByText(/Pop stash/)).toBeTruthy());

    fireEvent.click(screen.getByText("Pop"));
    await waitFor(() => expect(screen.getByText(/merge conflicts/)).toBeTruthy());
  });

  it("cancel on dirty state closes dialog", async () => {
    mockCheckoutBranch.mockResolvedValue({
      success: false,
      dirty: true,
      files: ["x.ts"],
    });
    const onClose = vi.fn();

    render(<BranchSwitchDialog cwd="/test" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("develop")).toBeTruthy());
    fireEvent.click(screen.getByText("develop"));
    await waitFor(() => expect(screen.getByText("Uncommitted Changes")).toBeTruthy());

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
