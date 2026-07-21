/**
 * DiffFileTree roll-up header + per-file counts + non-git summed badge
 * (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { DiffFileTree } from "../DiffFileTree.js";
import type { FileDiffEntry, FileOperationFailure } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

afterEach(cleanup);

const gitFiles: FileDiffEntry[] = [
  { path: "src/a.ts", changes: [{ type: "edit", timestamp: 1 }], additions: 3, deletions: 1 },
  { path: "src/new.ts", changes: [{ type: "write", timestamp: 2 }], additions: 5, deletions: 0 },
];

describe("DiffFileTree counts", () => {
  it("renders the aggregate header and per-file counts for a git session", () => {
    render(
      <DiffFileTree
        files={gitFiles}
        selection={null}
        onSelect={() => {}}
        totalAdditions={8}
        totalDeletions={1}
      />,
    );
    expect(screen.getByText("2 files changed")).toBeTruthy();
    // Aggregate header shows +8 (unique to the header).
    expect(screen.getByText("+8")).toBeTruthy();
    // Per-file counts present (a.ts +3, new.ts +5).
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("+5")).toBeTruthy();
    // −1 appears in both the header aggregate and the a.ts row.
    expect(screen.getAllByText("−1").length).toBe(2);
    // No summed badge for a git session.
    expect(screen.queryByText("summed")).toBeNull();
  });

  it("shows a summed badge when counts are summed per-turn deltas (non-git)", () => {
    render(
      <DiffFileTree
        files={gitFiles}
        selection={null}
        onSelect={() => {}}
        totalAdditions={8}
        totalDeletions={1}
        summed
      />,
    );
    expect(screen.getByText("summed")).toBeTruthy();
  });

  it("renders an empty tree with no changes", () => {
    render(<DiffFileTree files={[]} selection={null} onSelect={() => {}} />);
    expect(screen.getByText("0 files changed")).toBeTruthy();
  });
});

describe("DiffFileTree file-operation failures", () => {
  const failures: FileOperationFailure[] = [
    {
      toolCallId: "patch-1",
      toolName: "apply_patch",
      timestamp: 1,
      kind: "partial_failure",
      message: "One hunk did not apply",
      affectedPaths: ["src/a.ts", "src/new.ts"],
    },
    {
      toolCallId: "write-1",
      toolName: "Write",
      timestamp: 2,
      kind: "error",
      message: "Permission denied",
      affectedPaths: ["src/a.ts"],
    },
  ];

  it("renders affected-file badges with accessible operation counts", () => {
    render(<DiffFileTree files={gitFiles} fileOperationFailures={failures} selection={null} onSelect={() => {}} />);

    expect(screen.getByLabelText("2 failed operations affect src/a.ts")).toBeTruthy();
    expect(screen.getByLabelText("1 failed operation affects src/new.ts")).toBeTruthy();
  });

  it("renders each operation once and every affected path", () => {
    render(<DiffFileTree files={gitFiles} fileOperationFailures={failures} selection={null} onSelect={() => {}} />);

    expect(screen.getByText("Failed operations (2)")).toBeTruthy();
    expect(screen.getAllByText("apply_patch")).toHaveLength(1);
    expect(screen.getByText("One hunk did not apply")).toBeTruthy();
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Open src/a.ts" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open src/new.ts" })).toBeTruthy();
  });

  it("opens the existing diff selection when a failure path is activated", () => {
    const onSelect = vi.fn();
    render(<DiffFileTree files={gitFiles} fileOperationFailures={failures} selection={null} onSelect={onSelect} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Open src/a.ts" })[0]);
    expect(onSelect).toHaveBeenCalledWith({ filePath: "src/a.ts", changeIndex: null });
  });

  it("omits failure section and badges when no correlated failures exist", () => {
    render(<DiffFileTree files={gitFiles} fileOperationFailures={[]} selection={null} onSelect={() => {}} />);

    expect(screen.queryByText(/Failed operations/)).toBeNull();
    expect(screen.queryByLabelText(/failed operation/)).toBeNull();
  });
});
