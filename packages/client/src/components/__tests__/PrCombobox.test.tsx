/**
 * Tests for PrCombobox.
 * See change: add-worktree-from-pull-request.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { PrCombobox } from "../worktree/PrCombobox.js";
import type { PullRequestInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

// Mock the git-api module.
const mockFetchPullRequests = vi.fn();
vi.mock("../../lib/git/git-api.js", () => ({
  fetchPullRequests: (...args: any[]) => mockFetchPullRequests(...args),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const samplePrs: PullRequestInfo[] = [
  {
    number: 42,
    title: "Fix all the bugs",
    headRefName: "fix-all",
    headRefOid: "abc123",
    author: "alice",
    isDraft: false,
    isCrossRepository: false,
    checkRollup: "passing",
  },
  {
    number: 7,
    title: "WIP: new feature",
    headRefName: "feat/new",
    headRefOid: "def456",
    author: "bob",
    isDraft: true,
    isCrossRepository: true,
    checkRollup: "none",
  },
  {
    number: 99,
    title: "Pending checks",
    headRefName: "pending-pr",
    headRefOid: "ghi789",
    author: "carol",
    isDraft: false,
    isCrossRepository: false,
    checkRollup: "failing",
  },
];

function Controlled({ onGhUnavailable }: { onGhUnavailable?: (code: "gh_not_found" | "gh_not_authed") => void }) {
  const [value, setValue] = useState<PullRequestInfo | null>(null);
  return (
    <PrCombobox
      cwd="/repo"
      value={value}
      onChange={setValue}
      onGhUnavailable={onGhUnavailable}
      data-testid="prc"
    />
  );
}

describe("PrCombobox", () => {
  it("closed by default, opens on click and fetches PRs", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: samplePrs });

    render(<Controlled />);
    expect(screen.getByTestId("prc")).toBeTruthy();
    expect(screen.queryByTestId("prc-popover")).toBeNull();

    // Open.
    fireEvent.click(screen.getByTestId("prc"));
    expect(screen.getByTestId("prc-popover")).toBeTruthy();

    // Loading state.
    expect(screen.getByTestId("pr-combobox-loading")).toBeTruthy();

    // Wait for data.
    await waitFor(() => {
      expect(screen.queryByTestId("pr-combobox-loading")).toBeNull();
    });

    // Should show PR rows.
    expect(screen.getByText("#42")).toBeTruthy();
    expect(screen.getByText("Fix all the bugs")).toBeTruthy();
    expect(screen.getByText("@alice")).toBeTruthy();
  });

  it("shows error state on fetch failure", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: false, code: "git_failed", error: "oops" });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.getByTestId("pr-combobox-error")).toBeTruthy();
    });
    expect(screen.getByTestId("pr-combobox-error").textContent).toContain("oops");
  });

  it("shows empty state when no PRs", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: [] });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.getByTestId("pr-combobox-empty")).toBeTruthy();
    });
  });

  it("fires onGhUnavailable for gh_not_found", async () => {
    const onGhUnavailable = vi.fn();
    mockFetchPullRequests.mockResolvedValue({ ok: false, code: "gh_not_found", error: "gh_not_found" });

    render(<Controlled onGhUnavailable={onGhUnavailable} />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(onGhUnavailable).toHaveBeenCalledWith("gh_not_found");
    });
  });

  it("fires onGhUnavailable for gh_not_authed", async () => {
    const onGhUnavailable = vi.fn();
    mockFetchPullRequests.mockResolvedValue({ ok: false, code: "gh_not_authed", error: "gh_not_authed" });

    render(<Controlled onGhUnavailable={onGhUnavailable} />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(onGhUnavailable).toHaveBeenCalledWith("gh_not_authed");
    });
  });

  it("filters by number, title, and branch name", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: samplePrs });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.queryByTestId("pr-combobox-loading")).toBeNull();
    });

    // Type "42" to filter.
    const filter = screen.getByTestId("prc-filter");
    fireEvent.change(filter, { target: { value: "42" } });

    // Only PR #42 should be visible.
    expect(screen.getByText("#42")).toBeTruthy();
    expect(screen.queryByText("#7")).toBeNull();
    expect(screen.queryByText("#99")).toBeNull();
  });

  it("selects a PR via click", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: samplePrs });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.queryByTestId("pr-combobox-loading")).toBeNull();
    });

    // Click the first PR row.
    fireEvent.click(screen.getByText("Fix all the bugs"));

    // Popover should close.
    expect(screen.queryByTestId("prc-popover")).toBeNull();
    // Trigger should show the selected PR.
    expect(screen.getByTestId("prc").textContent).toContain("#42");
    expect(screen.getByTestId("prc").textContent).toContain("Fix all the bugs");
  });

  it("keyboard navigation: Arrow+Enter selects", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: samplePrs });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.queryByTestId("pr-combobox-loading")).toBeNull();
    });

    const filter = screen.getByTestId("prc-filter");
    // ArrowDown twice to highlight second item (#7), then Enter.
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    fireEvent.keyDown(filter, { key: "Enter" });

    // Popover should close and show #7.
    expect(screen.queryByTestId("prc-popover")).toBeNull();
    expect(screen.getByTestId("prc").textContent).toContain("#7");
  });

  it("Escape closes popover without closing parent", async () => {
    mockFetchPullRequests.mockResolvedValue({ ok: true, data: samplePrs });

    render(<Controlled />);
    fireEvent.click(screen.getByTestId("prc"));

    await waitFor(() => {
      expect(screen.queryByTestId("pr-combobox-loading")).toBeNull();
    });

    const filter = screen.getByTestId("prc-filter");
    fireEvent.keyDown(filter, { key: "Escape" });

    // Popover should close.
    expect(screen.queryByTestId("prc-popover")).toBeNull();
    // Trigger should still be there.
    expect(screen.getByTestId("prc")).toBeTruthy();
  });
});
