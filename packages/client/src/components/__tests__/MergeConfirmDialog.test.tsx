/**
 * Tests for MergeConfirmDialog. See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MergeConfirmDialog } from "../worktree/MergeConfirmDialog.js";

const fetchDiffStatMock = vi.fn();
const mergeWorktreeMock = vi.fn();
vi.mock("../../lib/git/git-api.js", () => ({
  fetchWorktreeDiffStat: (cwd: string) => fetchDiffStatMock(cwd),
  mergeWorktree: (args: any) => mergeWorktreeMock(args),
}));

afterEach(() => {
  cleanup();
  fetchDiffStatMock.mockReset();
  mergeWorktreeMock.mockReset();
});

describe("MergeConfirmDialog", () => {
  it("fetches diff-stat on open and renders summary + filesChanged", async () => {
    fetchDiffStatMock.mockResolvedValueOnce({
      ok: true,
      data: { summary: "a.txt | 3 +++\nb.txt | 1 -", filesChanged: 2, insertions: 3, deletions: 1, base: "main", branch: "feat/x" },
    });
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("merge-diff-stat")).toBeTruthy());
    expect(screen.getByTestId("merge-diff-stat").textContent).toContain("a.txt");
    expect(document.body.textContent).toContain("2 files");
  });

  it("disables Merge button when filesChanged === 0", async () => {
    fetchDiffStatMock.mockResolvedValueOnce({
      ok: true, data: { summary: "", filesChanged: 0, insertions: 0, deletions: 0, base: "main", branch: "feat/x" },
    });
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("merge-confirm")).toBeTruthy());
    expect((screen.getByTestId("merge-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Delete-branch checkbox is checked by default", async () => {
    fetchDiffStatMock.mockResolvedValueOnce({
      ok: true, data: { summary: "x", filesChanged: 1, insertions: 1, deletions: 0, base: "main", branch: "feat/x" },
    });
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("merge-delete-branch")).toBeTruthy());
    expect((screen.getByTestId("merge-delete-branch") as HTMLInputElement).checked).toBe(true);
  });

  it("clicking Merge invokes mergeWorktree with deleteBranch flag", async () => {
    fetchDiffStatMock.mockResolvedValueOnce({
      ok: true, data: { summary: "x", filesChanged: 1, insertions: 1, deletions: 0, base: "main", branch: "feat/x" },
    });
    mergeWorktreeMock.mockResolvedValueOnce({ ok: true, data: { mergeSha: "abc123", branchDeleted: true } });
    const onClose = vi.fn();
    const onMerged = vi.fn();
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={onClose} onMerged={onMerged} />);
    await waitFor(() => expect(screen.getByTestId("merge-confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("merge-confirm"));
    await waitFor(() => expect(mergeWorktreeMock).toHaveBeenCalledWith({ cwd: "/repo/.worktrees/x", deleteBranch: true }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledWith({ mergeSha: "abc123", branchDeleted: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces conflict stderr in a collapsed <details>", async () => {
    fetchDiffStatMock.mockResolvedValueOnce({
      ok: true, data: { summary: "x", filesChanged: 1, insertions: 1, deletions: 0, base: "main", branch: "feat/x" },
    });
    mergeWorktreeMock.mockResolvedValueOnce({ ok: false, code: "merge_conflict", error: "merge_conflict", stderr: "CONFLICT in foo" });
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("merge-confirm")).toBeTruthy());
    fireEvent.click(screen.getByTestId("merge-confirm"));
    await waitFor(() => expect(screen.getByTestId("merge-error")).toBeTruthy());
    expect(document.body.textContent).toContain("Merge conflict");
    expect(document.body.textContent).toContain("CONFLICT in foo");
  });
});

// test-plan #E14 (task 8.14) + #X4 dialog half (task 8.34).
// See change: redesign-composer-session-strip (D6).
describe("MergeConfirmDialog — PR warnings (#E14)", () => {
  const MIN = 60_000;
  const STAT = { ok: true, data: { summary: "a | 1 +", filesChanged: 1, insertions: 1, deletions: 0, base: "main", branch: "feat/x" } };
  const open = async (props: Partial<React.ComponentProps<typeof MergeConfirmDialog>>) => {
    fetchDiffStatMock.mockResolvedValueOnce(STAT);
    render(<MergeConfirmDialog cwd="/repo/.worktrees/x" onClose={() => {}} {...props} />);
    await waitFor(() => expect(screen.getByTestId("merge-diff-stat")).toBeTruthy());
    expect((screen.getByTestId("merge-confirm") as HTMLButtonElement).disabled).toBe(false);
  };
  const fresh = () => Date.now() - 1 * MIN;

  it("open PR, checks failing → failing warning", async () => {
    await open({ prNumber: 742, prState: "open", prChecks: "failing", prCheckedAt: fresh() });
    expect(screen.getByTestId("merge-warn-checks").textContent).toContain("PR #742 checks are failing");
    expect(screen.queryByTestId("merge-warn-stale")).toBeNull();
  });

  it("open PR, checks pending → still-running warning", async () => {
    await open({ prNumber: 742, prState: "open", prChecks: "pending", prCheckedAt: fresh() });
    expect(screen.getByTestId("merge-warn-checks").textContent).toContain("PR #742 checks are still running");
  });

  it.each(["passing", "none"] as const)("open PR, checks %s → no warning", async (prChecks) => {
    await open({ prNumber: 742, prState: "open", prChecks, prCheckedAt: fresh() });
    expect(screen.queryByTestId("merge-pr-warnings")).toBeNull();
  });

  it("no PR → no warning", async () => {
    await open({});
    expect(screen.queryByTestId("merge-pr-warnings")).toBeNull();
  });

  it("#X4: open passing PR checked 20 min ago → stale warning", async () => {
    await open({ prNumber: 742, prState: "open", prChecks: "passing", prCheckedAt: Date.now() - 20 * MIN });
    expect(screen.getByTestId("merge-warn-stale").textContent).toContain("PR status may be stale");
    expect(screen.queryByTestId("merge-warn-checks")).toBeNull();
  });

  it("closed PR with failing checks → no checks warning", async () => {
    await open({ prNumber: 742, prState: "closed", prChecks: "failing", prCheckedAt: fresh() });
    expect(screen.queryByTestId("merge-pr-warnings")).toBeNull();
  });
});
