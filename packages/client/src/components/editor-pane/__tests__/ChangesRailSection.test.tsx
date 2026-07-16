/**
 * ChangesRailSection — slim summary bar (change: collapse-diff-file-tree).
 * No per-file list, no DiffFileTree; shows Changes (N) · +X −Y · summed badge
 * · this-session-only toggle. Per-file rows now live in EditorFileTree.
 */

import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ diff: null as SessionDiffResponse | null }));
vi.mock("../../../hooks/useSessionDiff.js", () => ({
  useSessionDiff: () => ({ data: h.diff, isLoading: false, error: null, refresh: () => {} }),
}));

import { SessionDiffProvider } from "../../SessionDiffContext.js";
import { ChangesRailSection } from "../ChangesRailSection.js";

afterEach(cleanup);

function mount(diff: SessionDiffResponse) {
  h.diff = diff;
  return render(
    <SessionDiffProvider sessionId="s1">
      <ChangesRailSection sessionOnly={false} onSessionOnlyChange={() => {}} />
    </SessionDiffProvider>,
  );
}

describe("ChangesRailSection summary bar", () => {
  it("(F1) renders a summary bar with no per-file list / DiffFileTree", () => {
    mount({
      isGitRepo: true,
      totalAdditions: 8,
      totalDeletions: 1,
      files: [
        { path: "a.ts", changes: [{ type: "edit", timestamp: 1 }], additions: 3, deletions: 1 },
        { path: "b.ts", changes: [{ type: "write", timestamp: 2 }], additions: 5, deletions: 0 },
        { path: "c.ts", changes: [{ type: "edit", timestamp: 3 }], additions: 0, deletions: 0 },
      ],
    });
    expect(screen.getByTestId("changes-rail-section")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("(3)")).toBeTruthy();
    expect(screen.getByText("+8")).toBeTruthy();
    // No per-file rows leaked into the summary bar.
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("b.ts")).toBeNull();
    // No roll-up "N files changed" sub-header (that was DiffFileTree).
    expect(screen.queryByText(/files? changed/i)).toBeNull();
  });

  it("(E5) shows the summed badge for a non-git session", () => {
    mount({
      isGitRepo: false,
      totalAdditions: 12,
      totalDeletions: 4,
      files: [{ path: "a.ts", changes: [{ type: "write", timestamp: 1 }] }],
    });
    expect(screen.getByText("summed")).toBeTruthy();
    expect(screen.queryByText("a.ts")).toBeNull();
  });

  it("returns nothing when there are no changes", () => {
    const { container } = mount({ isGitRepo: true, files: [] });
    expect(container.querySelector("[data-testid='changes-rail-section']")).toBeNull();
  });
});
