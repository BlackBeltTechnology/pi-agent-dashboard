/**
 * OpenSpecBoardView — board layout, columns, filtering, new-proposal dialog.
 * See change: redesign-openspec-board.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {}, changeOrder: {} })),
  createGroup: vi.fn(async () => ({ id: "g-new", name: "New", order: 0 })),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(async () => {}),
  setChangeOrder: vi.fn(async () => {}),
}));
vi.mock("../../lib/openspec-config-api.js", () => ({
  useOpenSpecConfig: () => ({ profile: "custom", delivery: "both", workflows: [] }),
}));

import type { DashboardSession, OpenSpecData, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { OpenSpecBoardView } from "../OpenSpecBoardView.js";

afterEach(() => cleanup());
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

const groups: OpenSpecGroup[] = [
  { id: "in-flight", name: "In flight", color: "#eab308", order: 0 },
  { id: "backlog", name: "Backlog", color: "#a855f7", order: 1 },
];

const data: OpenSpecData = {
  initialized: true,
  changes: [
    { name: "add-auth", status: "in-progress", completedTasks: 3, totalTasks: 8, artifacts: [{ id: "proposal", status: "done" }], groupId: "in-flight" },
    { name: "fix-bug", status: "complete", completedTasks: 4, totalTasks: 4, artifacts: [{ id: "proposal", status: "done" }], groupId: "backlog" },
    { name: "plan-ui", status: "no-tasks", completedTasks: 0, totalTasks: 0, artifacts: [], groupId: null },
  ],
};

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return { id: "s1", cwd: "/p", source: "tui", status: "active", startedAt: Date.now(), name: "auth-impl", attachedProposal: "add-auth", ...over };
}

function props(over: Partial<React.ComponentProps<typeof OpenSpecBoardView>> = {}) {
  return {
    cwd: "/p", data, sessions: [makeSession()],
    openspecMap: new Map([["/p", data]]),
    groupsState: { groups, assignments: {}, changeOrder: {} },
    onBack: vi.fn(), onRefresh: vi.fn(), onReadArtifact: vi.fn(), onNavigateToSession: vi.fn(),
    onOpenSpecs: vi.fn(), onOpenArchive: vi.fn(), onSpawnSession: vi.fn(), onSpawnAttachedWorktree: vi.fn(),
    onResumeSession: vi.fn(), onHideSession: vi.fn(), onUnhideSession: vi.fn(), onSendPrompt: vi.fn(),
    onAttachProposal: vi.fn(), onDetachProposal: vi.fn(), onBulkArchive: vi.fn(),
    isGitRepo: true, gitWorktreeEnabled: true,
    ...over,
  };
}

describe("OpenSpecBoardView", () => {
  it("renders one column per group plus an always-present Ungrouped column", () => {
    render(<OpenSpecBoardView {...props()} />);
    expect(screen.getByTestId("board-column-in-flight")).toBeTruthy();
    expect(screen.getByTestId("board-column-backlog")).toBeTruthy();
    expect(screen.getByTestId("board-column-__ungrouped__")).toBeTruthy();
  });

  it("renders proposal cards with name + state pill", () => {
    render(<OpenSpecBoardView {...props()} />);
    expect(screen.getByTestId("board-card-add-auth")).toBeTruthy();
    expect(screen.getByTestId("board-card-fix-bug")).toBeTruthy();
    const pill = screen.getByTestId("board-card-add-auth").querySelector('[data-testid="board-card-state"]');
    // Pill carries a non-hue glyph prefix + the state label. Assert BOTH so a
    // regression dropping the glyph fails.
    // See change: extend-client-utils-state-feedback-primitives.
    expect(pill?.textContent).toContain("implementing");
    expect(pill?.textContent?.replace("implementing", "").trim()).not.toBe("");
  });

  it("navigates back via Back button", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("board-back"));
    expect(p.onBack).toHaveBeenCalled();
  });

  it("text filter matches proposal names", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.change(screen.getByTestId("board-filter-text"), { target: { value: "auth" } });
    expect(screen.getByTestId("board-card-add-auth")).toBeTruthy();
    expect(screen.queryByTestId("board-card-fix-bug")).toBeNull();
    expect(screen.queryByTestId("board-card-plan-ui")).toBeNull();
  });

  it("text filter matches session names", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.change(screen.getByTestId("board-filter-text"), { target: { value: "auth-impl" } });
    // add-auth has the matching session; others have none
    expect(screen.getByTestId("board-card-add-auth")).toBeTruthy();
    expect(screen.queryByTestId("board-card-fix-bug")).toBeNull();
  });

  it("state pill filters cards by lifecycle state", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.click(screen.getByTestId("state-pill-complete"));
    expect(screen.getByTestId("board-card-fix-bug")).toBeTruthy();
    expect(screen.queryByTestId("board-card-add-auth")).toBeNull();
  });

  it("session-status pill keeps only cards with a matching session", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.click(screen.getByTestId("sess-pill-Live"));
    expect(screen.getByTestId("board-card-add-auth")).toBeTruthy();
    expect(screen.queryByTestId("board-card-fix-bug")).toBeNull();
  });

  it("opens the new-proposal dialog from the top bar with worktree option", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    expect(screen.getByTestId("new-proposal-dialog")).toBeTruthy();
    expect(screen.getByTestId("np-worktree")).toBeTruthy();
  });

  it("column ＋ pre-fills the group in the new-proposal dialog", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.click(screen.getByTestId("col-new-proposal-backlog"));
    const select = screen.getByTestId("np-group") as HTMLSelectElement;
    expect(select.value).toBe("backlog");
  });

  it("create & spawn fires onSpawnSession with the change name", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    fireEvent.change(screen.getByTestId("np-name"), { target: { value: "add-thing" } });
    fireEvent.click(screen.getByTestId("np-create"));
    expect(p.onSpawnSession).toHaveBeenCalledWith("/p", "add-thing");
  });

  it("worktree-checked create fires onSpawnAttachedWorktree", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    fireEvent.change(screen.getByTestId("np-name"), { target: { value: "add-thing" } });
    fireEvent.click(screen.getByTestId("np-worktree"));
    fireEvent.click(screen.getByTestId("np-create"));
    expect(p.onSpawnAttachedWorktree).toHaveBeenCalledWith("/p", "add-thing");
  });

  it("proposal cards carry a grab cursor for drag affordance", () => {
    render(<OpenSpecBoardView {...props()} />);
    const card = screen.getByTestId("board-card-add-auth");
    expect(card.className).toContain("cursor-grab");
    expect(card.className).toContain("active:cursor-grabbing");
  });

  it("clicking a session row navigates to the session", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("board-session-row"));
    expect(p.onNavigateToSession).toHaveBeenCalledWith("s1");
  });
});

// ── Status stripes + auto-scroll (port-session-card-state-visuals-to-openspec-board)
describe("OpenSpecBoardView status stripes", () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  function rowStripe() {
    return screen.getByTestId("board-session-row").querySelector(".card-stripes-fx");
  }

  it("running session row carries card-stripes-running", () => {
    render(<OpenSpecBoardView {...props({ sessions: [makeSession({ status: "streaming" })] })} />);
    expect(rowStripe()?.className).toContain("card-stripes-running");
  });

  it("unread session row carries card-stripes-unread", () => {
    render(<OpenSpecBoardView {...props({ sessions: [makeSession({ status: "idle", unread: true })] })} />);
    expect(rowStripe()?.className).toContain("card-stripes-unread");
  });

  it("ask_user session row carries card-stripes-input", () => {
    render(<OpenSpecBoardView {...props({ sessions: [makeSession({ status: "streaming", currentTool: "ask_user" })] })} />);
    expect(rowStripe()?.className).toContain("card-stripes-input");
  });

  it("idle session row renders no stripe overlay", () => {
    render(<OpenSpecBoardView {...props({ sessions: [makeSession({ status: "idle" })] })} />);
    expect(rowStripe()).toBeNull();
  });

  it("proposal card aggregates to the most-urgent child (ask_user wins)", () => {
    render(<OpenSpecBoardView {...props({ sessions: [
      makeSession({ id: "a", status: "streaming" }),
      makeSession({ id: "b", status: "idle", currentTool: "ask_user" }),
    ] })} />);
    const card = screen.getByTestId("board-card-add-auth");
    // The card's own overlay is its first child; row overlays live deeper.
    const cardOverlay = card.querySelector(":scope > .card-stripes-fx");
    expect(cardOverlay?.className).toContain("card-stripes-input");
  });

  it("all-ended proposal renders no card-level stripe", () => {
    render(<OpenSpecBoardView {...props({ sessions: [makeSession({ status: "ended" })] })} />);
    const card = screen.getByTestId("board-card-add-auth");
    expect(card.querySelector(":scope > .card-stripes-fx")).toBeNull();
  });

  it("selecting an unclicked session scrolls its row into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { rerender } = render(<OpenSpecBoardView {...props({ selectedId: undefined })} />);
    scrollIntoView.mockClear();
    rerender(<OpenSpecBoardView {...props({ selectedId: "s1" })} />);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("clicking a visible row does not jump scroll", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const p = props({ selectedId: undefined });
    const { rerender } = render(<OpenSpecBoardView {...p} />);
    scrollIntoView.mockClear();
    // User clicks the row, then the parent re-renders with that id selected.
    fireEvent.click(screen.getByTestId("board-session-row"));
    rerender(<OpenSpecBoardView {...props({ ...p, selectedId: "s1" })} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
