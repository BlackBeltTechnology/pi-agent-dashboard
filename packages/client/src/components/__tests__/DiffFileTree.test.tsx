/**
 * DiffFileTree roll-up header + per-file counts + non-git summed badge
 * (change: add-change-summary-table).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DiffFileTree } from "../DiffFileTree.js";
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

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
