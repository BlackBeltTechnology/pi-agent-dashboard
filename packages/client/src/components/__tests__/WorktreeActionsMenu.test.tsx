/**
 * Tests for WorktreeActionsMenu. See change: add-worktree-lifecycle-actions.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { WorktreeActionsMenu, __resetGhAvailableCache } from "../worktree/WorktreeActionsMenu.js";
import { PopoverBoundaryProvider } from "../../lib/state/PopoverBoundaryContext.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Stub useMobile + git-api + tools-api so we drive every branch.
let mobile = false;
let ghOk = true;
vi.mock("../../hooks/useMobile.js", () => ({ useMobile: () => mobile }));
vi.mock("../../lib/git/git-api.js", () => ({
  pushWorktreeBranch: vi.fn(async () => ({ ok: true })),
  createWorktreePR: vi.fn(async () => ({ ok: true, data: { url: "https://gh/pr/1", pushed: false } })),
  fetchWorktreeDiffStat: vi.fn(async () => ({ ok: true, data: { summary: "", filesChanged: 0, insertions: 0, deletions: 0, base: "main", branch: "feat/x" } })),
  mergeWorktree: vi.fn(async () => ({ ok: true, data: { mergeSha: "abc", branchDeleted: false } })),
  removeWorktree: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../lib/api/tools-api.js", () => ({
  fetchTool: vi.fn(async (name: string) => ({
    name,
    kind: "binary",
    ok: ghOk,
    source: "system",
    path: ghOk ? "/usr/bin/" + name : null,
  })),
}));

afterEach(() => {
  cleanup();
  mobile = false;
  ghOk = true;
  __resetGhAvailableCache();
  vi.clearAllMocks();
});

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo/.worktrees/feat-x",
    source: "dashboard",
    status: "active",
    startedAt: 1,
    gitWorktree: { mainPath: "/repo", name: "feat-x", base: "main" },
    ...over,
  } as DashboardSession;
}

function renderMenu(session: DashboardSession, allSessions: DashboardSession[] = []) {
  return render(<WorktreeActionsMenu session={session} allSessions={allSessions} onShutdownSession={() => {}} />);
}

describe("WorktreeActionsMenu — desktop", () => {
  it("renders all four action buttons for a worktree session when gh is available", async () => {
    renderMenu(makeSession());
    expect(screen.getByTestId("worktree-action-push")).toBeTruthy();
    expect(screen.getByTestId("worktree-action-merge")).toBeTruthy();
    expect(screen.getByTestId("worktree-action-close")).toBeTruthy();
    // PR button is gh-gated and arrives async via probeGhAvailable.
    await waitFor(() => expect(screen.getByTestId("worktree-action-pr")).toBeTruthy());
  });

  it("hides the PR button when gh is NOT resolvable (no existing PR)", async () => {
    ghOk = false;
    renderMenu(makeSession());
    // Allow the gh probe to resolve.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("worktree-action-pr")).toBeNull();
  });

  it("still shows 'View PR' button when gh missing but gitPrNumber is set", async () => {
    ghOk = false;
    renderMenu(makeSession({ gitPrNumber: 7, gitPrUrl: "https://gh/pr/7" }));
    await waitFor(() => expect(screen.getByTestId("worktree-action-pr")).toBeTruthy());
    expect(screen.getByTestId("worktree-action-pr").textContent).toContain("View PR #7");
  });

  it("does not render for a session without gitWorktree", () => {
    renderMenu(makeSession({ gitWorktree: undefined }));
    expect(screen.queryByTestId("worktree-actions-menu")).toBeNull();
  });

  it("Open PR toggles to 'View PR #N' label when gitPrNumber is set", async () => {
    renderMenu(makeSession({ gitPrNumber: 42, gitPrUrl: "https://gh/pr/42" }));
    await waitFor(() => expect(screen.getByTestId("worktree-action-pr")).toBeTruthy());
    expect(screen.getByTestId("worktree-action-pr").textContent).toContain("View PR #42");
  });

  it("clicking 'Merge' opens the merge confirm dialog", () => {
    renderMenu(makeSession());
    fireEvent.click(screen.getByTestId("worktree-action-merge"));
    expect(screen.getByTestId("merge-confirm-dialog")).toBeTruthy();
  });

  it("clicking 'Close' opens the close-worktree dialog", () => {
    renderMenu(makeSession());
    fireEvent.click(screen.getByTestId("worktree-action-close"));
    expect(screen.getByTestId("close-worktree-dialog")).toBeTruthy();
  });

  it("Push action shows a success toast on ok response", async () => {
    renderMenu(makeSession());
    fireEvent.click(screen.getByTestId("worktree-action-push"));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("worktree-actions-toast").textContent).toContain("Pushed");
  });

  it("PR failure shows human-readable label + stderr in <details>", async () => {
    const gitApi = await import("../../lib/git/git-api.js");
    (gitApi.createWorktreePR as any).mockResolvedValueOnce({
      ok: false,
      code: "pushed_but_pr_failed",
      error: "pushed_but_pr_failed",
      stderr: "GraphQL: No commits between develop and feat/x",
    });
    renderMenu(makeSession());
    await waitFor(() => expect(screen.getByTestId("worktree-action-pr")).toBeTruthy());
    fireEvent.click(screen.getByTestId("worktree-action-pr"));
    await waitFor(() => expect(screen.getByTestId("worktree-actions-toast")).toBeTruthy());
    const toast = screen.getByTestId("worktree-actions-toast");
    // Human-readable label, NOT the raw code.
    expect(toast.textContent).toContain("branch pushed, but `gh pr create` failed");
    // stderr surfaced via the details disclosure.
    expect(screen.getByTestId("worktree-actions-toast-details").textContent).toContain("No commits between develop");
  });
});

// F9 (fix-popover-container-clip). The mobile `right-0` action sheet is a
// `usePopoverFlip` consumer wired to `PopoverBoundaryContext`. The docker E2E
// harness has no worktree-session fixture (WorktreeActionsMenu renders null
// without `session.gitWorktree`), so its boundary-aware flip is proven here at
// the component level with mocked rects instead of L3. rect helper:
function rect(over: Partial<DOMRect>): DOMRect {
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...over } as DOMRect;
}

function BoundaryHarness({ session, boundaryRect }: { session: DashboardSession; boundaryRect: DOMRect }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (ref.current) ref.current.getBoundingClientRect = () => boundaryRect;
  });
  return (
    <div ref={ref}>
      <PopoverBoundaryProvider value={ref}>
        <WorktreeActionsMenu session={session} allSessions={[]} onShutdownSession={() => {}} />
      </PopoverBoundaryProvider>
    </div>
  );
}

describe("WorktreeActionsMenu — F9 boundary-aware sheet (fix-popover-container-clip)", () => {
  beforeEach(() => { mobile = true; });

  it("flips the mobile sheet to left-0 when the pane's right anchor cannot fit", () => {
    // Boundary pane offset right {left:500,right:900}; trigger hugs the pane's
    // LEFT edge → right-anchor (extend left) has ~32px, left-anchor (extend
    // right) has ~382px → the hook must flip the `right-0` sheet to `left-0`.
    render(<BoundaryHarness session={makeSession()} boundaryRect={rect({ left: 500, right: 900, bottom: 1000, width: 400, height: 1000, x: 500 })} />);
    const trigger = screen.getByTestId("worktree-actions-mobile-trigger");
    (trigger as HTMLElement).getBoundingClientRect = () =>
      rect({ left: 510, right: 540, top: 100, bottom: 130, width: 30, height: 30, x: 510, y: 100 });
    fireEvent.click(trigger);
    const sheet = screen.getByTestId("worktree-actions-mobile-sheet");
    expect(sheet.className).toContain("left-0");
    expect(sheet.className).not.toContain("right-0");
  });

  it("keeps the sheet right-0 (default) when the pane has ample room to the left", () => {
    // Trigger near the pane's RIGHT edge with a wide pane → right-anchor fits →
    // no flip, preserves the existing `right-0` behavior.
    render(<BoundaryHarness session={makeSession()} boundaryRect={rect({ left: 0, right: 900, bottom: 1000, width: 900, height: 1000 })} />);
    const trigger = screen.getByTestId("worktree-actions-mobile-trigger");
    (trigger as HTMLElement).getBoundingClientRect = () =>
      rect({ left: 840, right: 870, top: 100, bottom: 130, width: 30, height: 30, x: 840, y: 100 });
    fireEvent.click(trigger);
    const sheet = screen.getByTestId("worktree-actions-mobile-sheet");
    expect(sheet.className).toContain("right-0");
    expect(sheet.className).not.toContain("left-0");
  });
});

describe("WorktreeActionsMenu — mobile", () => {
  beforeEach(() => { mobile = true; });

  it("renders a ⋯ trigger instead of inline buttons", () => {
    renderMenu(makeSession());
    expect(screen.getByTestId("worktree-actions-mobile-trigger")).toBeTruthy();
    expect(screen.queryByTestId("worktree-action-push")).toBeNull();
  });

  it("opens an action sheet on click revealing the four actions", async () => {
    renderMenu(makeSession());
    await waitFor(() => expect(screen.getByTestId("worktree-actions-mobile-trigger")).toBeTruthy());
    fireEvent.click(screen.getByTestId("worktree-actions-mobile-trigger"));
    expect(screen.getByTestId("worktree-actions-mobile-sheet")).toBeTruthy();
    expect(screen.getByTestId("worktree-action-push")).toBeTruthy();
    expect(screen.getByTestId("worktree-action-merge")).toBeTruthy();
  });

  it("mobile sheet hides until the trigger is clicked", () => {
    renderMenu(makeSession());
    expect(screen.queryByTestId("worktree-actions-mobile-sheet")).toBeNull();
  });
});
