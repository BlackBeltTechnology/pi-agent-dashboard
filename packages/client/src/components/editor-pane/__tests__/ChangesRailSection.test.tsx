/**
 * ChangesRailSection integration (change: add-change-summary-table):
 * renders the shared session-diff files and opens a `diff:` tab on row select.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";

const DIFF: SessionDiffResponse = {
  isGitRepo: true,
  totalAdditions: 8,
  totalDeletions: 1,
  files: [
    { path: "a.ts", changes: [{ type: "edit", timestamp: 1 }], additions: 3, deletions: 1 },
    { path: "b.ts", changes: [{ type: "write", timestamp: 2 }], additions: 5, deletions: 0 },
  ],
};

// Mock the shared-diff fetch so SessionDiffProvider yields canned data (no network).
vi.mock("../../../hooks/useSessionDiff.js", () => ({
  useSessionDiff: () => ({ data: DIFF, isLoading: false, error: null, refresh: () => {} }),
}));

import { ChangesRailSection } from "../ChangesRailSection.js";
import { SessionDiffProvider } from "../../SessionDiffContext.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../SplitWorkspaceContext.js";

afterEach(cleanup);

function OpenTabsProbe() {
  const { paneState } = useSplitWorkspace();
  return <div data-testid="open-tabs">{paneState.openFiles.map((f) => f.path).join("|")}</div>;
}

function mount() {
  return render(
    <SplitWorkspaceProvider sessionId="s1" cwd="/repo" orientation="h">
      <SessionDiffProvider sessionId="s1">
        <ChangesRailSection />
        <OpenTabsProbe />
      </SessionDiffProvider>
    </SplitWorkspaceProvider>,
  );
}

describe("ChangesRailSection", () => {
  it("renders the Changes header + per-file rows from the shared diff", () => {
    mount();
    expect(screen.getByTestId("changes-rail-section")).toBeTruthy();
    expect(screen.getByText("Changes")).toBeTruthy();
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
    // Aggregate header count (+8).
    expect(screen.getByText("+8")).toBeTruthy();
  });

  it("opens a diff: tab when a Changes row is activated", () => {
    mount();
    fireEvent.click(screen.getByText("a.ts"));
    expect(screen.getByTestId("open-tabs").textContent).toContain("diff:a.ts");
  });
});
