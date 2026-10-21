/**
 * OpenSpecBoardView — board layout, columns, filtering, new-proposal dialog.
 * See change: redesign-openspec-board.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {}, changeOrder: {} })),
  createGroup: vi.fn(async () => ({ id: "g-new", name: "New", order: 0 })),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(async () => {}),
  setChangeOrder: vi.fn(async () => {}),
}));
const wfState = vi.hoisted(() => ({ workflows: [] as string[] }));
vi.mock("../../lib/openspec/openspec-config-api.js", () => ({
  useOpenSpecConfig: () => ({ profile: "custom", delivery: "both", workflows: wfState.workflows }),
}));

import type { ChangeDependencies, DashboardSession, OpenSpecChange, OpenSpecData, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { __resetArchiveCache } from "../../lib/openspec/archive-cache.js";
import { OpenSpecBoardView } from "../openspec/OpenSpecBoardView.js";

afterEach(() => {
  cleanup();
  wfState.workflows = [];
});
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
    onResumeSession: vi.fn(), onArchiveSession: vi.fn(), onSendPrompt: vi.fn(),
    onAttachProposal: vi.fn(), onDetachProposal: vi.fn(), onBulkArchive: vi.fn(),
    worktreeAvailability: { available: true },
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

  // Card = name + compact lifecycle bar; the bar's Tasks segment subsumes the
  // old state pill + progress block. See change: compact-openspec-lifecycle-bar (E11).
  it("renders proposal cards with name + compact lifecycle bar (no pill, no progress block)", () => {
    render(<OpenSpecBoardView {...props()} />);
    expect(screen.getByTestId("board-card-fix-bug")).toBeTruthy();
    const card = screen.getByTestId("board-card-add-auth");
    const bar = card.querySelector<HTMLElement>('[data-testid="openspec-stepper"]');
    expect(bar?.getAttribute("data-variant")).toBe("compact");
    expect(bar?.querySelector('[data-testid="stepper-segment-tasks"]')?.textContent).toContain("3/8");
    expect(card.querySelector('[data-testid="board-card-state"]')).toBeNull();
    expect(card.querySelector('[data-testid="board-card-progress"]')).toBeNull();
    expect(bar?.querySelector('[data-testid="openspec-overflow-btn"]')).toBeNull();
    expect(bar?.querySelector('[data-testid="apply-btn"]')).toBeNull();
  });

  // Nested ⋯ inside the per-session OpenSpec panel: Detach fires for that
  // session without navigating. See change: compact-openspec-lifecycle-bar (F8).
  it("session-row panel ⋯ → Detach fires onDetachProposal, no navigation", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("session-os-menu-s1"));
    const panel = screen.getByTestId("session-os-menu-panel");
    fireEvent.click(panel.querySelector('[data-testid="openspec-overflow-btn"]')!);
    fireEvent.pointerDown(screen.getByTestId("detach-btn"));
    fireEvent.click(screen.getByTestId("detach-btn"));
    expect(p.onDetachProposal).toHaveBeenCalledWith("s1");
    expect(p.onNavigateToSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("board-card-add-auth").className).not.toContain("opacity-40");
  });

  // The desktop session CARD condenses to state only, but the board's per-session
  // panel keeps the full OpenSpec block. See change: add-session-actions-flyout (E22).
  it("session-row panel keeps the Apply primary and a ⋯ listing Explore… and Detach (E22)", () => {
    const implementing: OpenSpecData = {
      ...data,
      changes: [
        { name: "add-auth", status: "in-progress", completedTasks: 3, totalTasks: 8, groupId: "in-flight", artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "done" }, { id: "specs", status: "done" }] },
        ...data.changes.slice(1),
      ],
    };
    wfState.workflows = ["apply", "explore", "continue", "ff", "verify", "archive"];
    render(<OpenSpecBoardView {...props({ data: implementing, openspecMap: new Map([["/p", implementing]]) })} />);
    fireEvent.click(screen.getByTestId("session-os-menu-s1"));
    const panel = screen.getByTestId("session-os-menu-panel");
    expect(panel.querySelector('[data-testid="apply-btn"]')).toBeTruthy();
    fireEvent.click(panel.querySelector('[data-testid="openspec-overflow-btn"]')!);
    expect(screen.getByTestId("explore-menu-item")).toBeTruthy();
    expect(screen.getByTestId("detach-btn")).toBeTruthy();
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
    expect(p.onSpawnSession).toHaveBeenCalledWith("/p", "add-thing", { focus: false });
  });

  // See change: openspec-board-spawn-no-focus (test-plan #E12)
  it("card + Session spawns with the no-focus intent", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("card-new-session-add-auth"));
    expect(p.onSpawnSession).toHaveBeenCalledWith("/p", "add-auth", { focus: false });
  });

  it("worktree-checked create fires onSpawnAttachedWorktree", () => {
    const p = props();
    render(<OpenSpecBoardView {...p} />);
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    fireEvent.change(screen.getByTestId("np-name"), { target: { value: "add-thing" } });
    fireEvent.click(screen.getByTestId("np-worktree"));
    fireEvent.click(screen.getByTestId("np-create"));
    expect(p.onSpawnAttachedWorktree).toHaveBeenCalledWith("/p", "add-thing");
    // test-plan #E13: worktree path never goes through onSpawnSession.
    expect(p.onSpawnSession).not.toHaveBeenCalled();
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

  it("session OS menu panel has fixed and z-popover, not absolute or z-50 (overlay-layering)", () => {
    render(<OpenSpecBoardView {...props()} />);
    fireEvent.click(screen.getByTestId("session-os-menu-s1"));
    const panel = screen.getByTestId("session-os-menu-panel");
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("z-popover");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("z-50");
  });
});

// ── Dependencies (add-openspec-change-dependencies) ─────────────────────────
describe("OpenSpecBoardView — dependencies", () => {
  const deps = (over: Partial<ChangeDependencies> = {}): ChangeDependencies => ({
    hasFile: false, blockedBy: [], blocks: [], related: [], overlaps: [], wave: 1, issues: [], ...over,
  });
  const change = (name: string, dependencies?: ChangeDependencies, over: Partial<OpenSpecChange> = {}): OpenSpecChange => ({
    name, status: "no-tasks", completedTasks: 0, totalTasks: 0, artifacts: [{ id: "proposal", status: "done" }], groupId: null,
    ...(dependencies ? { dependencies } : {}), ...over,
  });
  const schema = (configured: string | null) => ({ configured, generated: "current" as const, missing: false, unpinnedChanges: [], affectedChanges: [], projectSchemas: [] });
  const board = (changes: OpenSpecChange[], configured: string | null = "pi-spec-driven") => {
    const d: OpenSpecData = { initialized: true, changes, workflowSchema: schema(configured) };
    return props({ data: d, sessions: [], openspecMap: new Map([["/p", d]]) });
  };
  const columnOrder = () =>
    [...screen.getByTestId("board-column-__ungrouped__").querySelectorAll('[data-testid="board-card-name"]')].map((e) => e.textContent);

  it("#F1 chips and wave badge render for pi-spec-driven or when a change has a file; not otherwise", () => {
    const withEdge = deps({ wave: 2, blockedBy: [{ change: "a", source: "declared", state: "open" }] });
    const rows: Array<[string | null, OpenSpecChange[], boolean]> = [
      ["pi-spec-driven", [change("a", deps()), change("b", withEdge)], true],
      ["spec-driven", [change("a", deps()), change("b", { ...withEdge, hasFile: true })], true],
      ["spec-driven", [change("a", deps()), change("b", withEdge)], false],
    ];
    for (const [configured, changes, visible] of rows) {
      const { unmount } = render(<OpenSpecBoardView {...board(changes, configured)} />);
      const card = screen.getByTestId("board-card-b");
      expect(!!card.querySelector('[data-testid="dep-chip-blockedBy"]')).toBe(visible);
      expect(!!card.querySelector('[data-testid="dep-wave"]')).toBe(visible);
      // The editor stays reachable while the chips are hidden (opt-in from the board).
      expect(screen.getByTestId("card-dependencies-b")).toBeTruthy();
      unmount();
    }
  });

  it("#F1 (review) a real mouse click opens the list and a second click closes it; a keyboard focus still opens it", () => {
    const c = change("b", deps({ blockedBy: [{ change: "x", source: "declared", state: "open" }] }));
    render(<OpenSpecBoardView {...board([change("x", deps()), c])} />);
    const chip = within(screen.getByTestId("board-card-b")).getByTestId("dep-chip-blockedBy");
    // A browser's mouse gesture: mousedown focuses the button unless its default is prevented, then click.
    const mouseClick = () => {
      if (fireEvent.mouseDown(chip)) fireEvent.focus(chip);
      fireEvent.click(chip);
    };
    mouseClick();
    expect(screen.queryByTestId("dep-list-blockedBy")).not.toBeNull();
    mouseClick();
    expect(screen.queryByTestId("dep-list-blockedBy")).toBeNull();
    fireEvent.focus(chip); // keyboard Tab
    expect(screen.queryByTestId("dep-list-blockedBy")).not.toBeNull();
  });

  it("#F1 focusing 'blocked by 1' lists the blocker with its source and reason; inferred edges look different", () => {
    const c = change("b", deps({
      blockedBy: [
        { change: "x", source: "declared", state: "open", reason: "api" },
        { change: "y", source: "inferred-text", state: "open", reason: "Depends on: `y`" },
      ],
    }));
    render(<OpenSpecBoardView {...board([change("x", deps()), change("y", deps()), c])} />);
    const chip = within(screen.getByTestId("board-card-b")).getByTestId("dep-chip-blockedBy");
    expect(chip.textContent).toBe("blocked by 2");
    expect(screen.queryByTestId("dep-list-blockedBy")).toBeNull();
    fireEvent.focus(chip);
    const list = screen.getByTestId("dep-list-blockedBy");
    const [declared, inferred] = [...list.querySelectorAll("li")];
    expect(declared.textContent).toContain("x");
    expect(declared.textContent).toContain("declared");
    expect(declared.textContent).toContain("api");
    expect(inferred.getAttribute("data-source")).toBe("inferred-text");
    expect(inferred.className).toContain("italic");
    expect(declared.className).not.toContain("italic");
    expect(inferred.textContent).toContain("inferred from text");
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByTestId("dep-list-blockedBy")).toBeNull();
  });

  it("#F8 a card keeps its lifecycle content and adds 'blocked by 1' and the wave", () => {
    const auth = change("add-auth", deps({ wave: 2, blockedBy: [{ change: "base", source: "declared", state: "open" }] }), {
      status: "in-progress", completedTasks: 3, totalTasks: 8,
      artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "done" }, { id: "specs", status: "done" }, { id: "tasks", status: "ready" }],
    });
    render(<OpenSpecBoardView {...board([change("base", deps()), auth])} />);
    const card = screen.getByTestId("board-card-add-auth");
    expect(card.querySelector('[data-testid="stepper-segment-tasks"]')?.textContent).toContain("3/8");
    expect(card.querySelector('[data-testid="dep-chip-blockedBy"]')?.textContent).toBe("blocked by 1");
    expect(card.querySelector('[data-testid="dep-wave"]')?.textContent).toBe("wave 2");
  });

  it("#F6 the declare hint shows for a ready dependencies artifact (even with the UI hidden); not blocked or fallback-path", () => {
    const ready = change("r", deps(), { artifacts: [{ id: "proposal", status: "done" }, { id: "dependencies", status: "ready" }] });
    const blocked = change("k", deps(), { artifacts: [{ id: "proposal", status: "done" }, { id: "dependencies", status: "blocked" }] });
    const fallback = change("f", undefined, { artifacts: [{ id: "proposal", status: "done" }, { id: "dependencies", status: "ready" }] });
    render(<OpenSpecBoardView {...board([ready, blocked, fallback], "spec-driven")} />);
    expect(screen.queryByTestId("card-declare-dependencies-r")).toBeTruthy();
    expect(screen.queryByTestId("card-declare-dependencies-k")).toBeNull();
    expect(screen.queryByTestId("card-declare-dependencies-f")).toBeNull();
    expect(screen.queryByTestId("card-dependencies-f")).toBeNull(); // no graph → no editor action either
  });

  it("#F2 Execution order sorts by wave without touching changeOrder; the toggle is absent without a graph", async () => {
    const { setChangeOrder } = await import("../../lib/openspec/openspec-groups-api.js");
    const col = [
      change("c", deps({ wave: 3 })), change("a", deps({ wave: 1 })), change("x", deps({ wave: null })),
      change("b", deps({ wave: 2 })), change("y"),
    ];
    const { unmount } = render(<OpenSpecBoardView {...board(col)} />);
    const before = columnOrder();
    fireEvent.click(screen.getByTestId("board-execution-order"));
    expect(columnOrder()).toEqual(["a", "b", "c", "x", "y"]);
    fireEvent.click(screen.getByTestId("board-execution-order"));
    expect(columnOrder()).toEqual(before);
    expect(setChangeOrder).not.toHaveBeenCalled();
    unmount();

    render(<OpenSpecBoardView {...board([change("a"), change("b")])} />);
    expect(screen.queryByTestId("board-execution-order")).toBeNull();
  });
});

describe("OpenSpecBoardView — dependencies dialog", () => {
  const FILE = { mtimeMs: 1700000000000.5, size: 88 };
  const base = (over: Record<string, unknown> = {}) => ({
    dependencies: {
      hasFile: true, wave: 2, related: ["w", "z"], overlaps: [], issues: [], blocks: ["qux"],
      blockedBy: [
        { change: "x", source: "declared", state: "open", reason: "r" },
        { change: "bar", source: "inferred-text", state: "open", reason: "Depends on: `bar`" },
      ],
    },
    declared: { blockedBy: [{ change: "x", reason: "r" }], notBlockedBy: ["y"], related: ["w"] },
    declaredError: null,
    file: FILE,
    ...over,
  });
  let getBody: Record<string, unknown>;
  let putStatus: { code: number; body: unknown };
  let archiveBody: unknown[];
  const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit | undefined]>;
  const puts = () => calls().filter(([u, i]) => String(u).includes("/api/openspec/dependencies") && i?.method === "PUT");
  const gets = () => calls().filter(([u, i]) => String(u).includes("/api/openspec/dependencies") && !i?.method);

  beforeEach(() => {
    getBody = base();
    putStatus = { code: 200, body: { success: true, data: { file: { mtimeMs: 1, size: 2 } } } };
    archiveBody = [];
    __resetArchiveCache(); // module-level cache: never let an earlier test's listing leak in
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/openspec/dependencies")) {
        if (init?.method === "PUT") return new Response(JSON.stringify(putStatus.body), { status: putStatus.code });
        return new Response(JSON.stringify({ success: true, data: getBody }), { status: 200 });
      }
      if (url.includes("/api/openspec-archive")) return new Response(JSON.stringify({ success: true, data: archiveBody }), { status: 200 });
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const openFor = async () => {
    const d: OpenSpecData = {
      initialized: true,
      workflowSchema: { configured: "pi-spec-driven", generated: "current", missing: false, unpinnedChanges: [], affectedChanges: [], projectSchemas: [] },
      changes: ["foo", "x", "y", "bar", "qux"].map((n) => ({
        name: n, status: "no-tasks" as const, completedTasks: 0, totalTasks: 0, artifacts: [], groupId: null,
        dependencies: { hasFile: false, blockedBy: [], blocks: [], related: [], overlaps: [], wave: 1, issues: [] },
      })),
    };
    render(<OpenSpecBoardView {...props({ data: d, sessions: [], openspecMap: new Map([["/p", d]]) })} />);
    fireEvent.click(screen.getByTestId("card-dependencies-foo"));
    return screen.findByTestId("deps-dialog");
  };

  it("#F4 round trip: keeps declared reasons and rejections, adds the rejection, drops prose-only related, sends GET's file as expected", async () => {
    const dialog = await openFor();
    await within(dialog).findByTestId("deps-declared-x");
    expect(within(dialog).queryByTestId("deps-related-z")).toBeNull(); // computed prose-only `related`
    fireEvent.click(within(dialog).getByTestId("deps-not-dependency-bar"));
    expect(within(dialog).queryByTestId("deps-inferred-bar")).toBeNull();
    fireEvent.click(within(dialog).getByTestId("deps-save"));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0][1]!.body))).toEqual({
      cwd: "/p", change: "foo",
      blockedBy: [{ change: "x", reason: "r" }],
      notBlockedBy: ["y", "bar"],
      related: ["w"],
      expected: FILE,
    });
  });

  it("#F4 the blocks list is read-only and links to the other change's dialog", async () => {
    const dialog = await openFor();
    const link = await within(dialog).findByTestId("deps-blocks-qux");
    expect(link.tagName).toBe("BUTTON");
    fireEvent.click(link);
    await waitFor(() => expect(gets().some(([u]) => String(u).includes("change=qux"))).toBe(true));
  });

  it("#F4 the picker adds a blocker with its reason", async () => {
    const dialog = await openFor();
    await within(dialog).findByTestId("deps-declared-x");
    fireEvent.change(within(dialog).getByTestId("deps-picker"), { target: { value: "qux" } });
    fireEvent.change(within(dialog).getByTestId("deps-picker-reason"), { target: { value: "needs it" } });
    fireEvent.click(within(dialog).getByTestId("deps-add"));
    expect(within(dialog).getByTestId("deps-declared-qux").textContent).toContain("needs it");
    fireEvent.click(within(dialog).getByTestId("deps-save"));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0][1]!.body)).blockedBy).toEqual([{ change: "x", reason: "r" }, { change: "qux", reason: "needs it" }]);
  });

  it("#F4 (review) the picker offers archived changes but never tagged (SHELVED) entries, whose names cannot validate", async () => {
    archiveBody = [
      { name: "2026-10-01-old-one", date: "2026-10-01", artifacts: [] },
      { name: "2026-05-28-SHELVED-qux", date: "2026-05-28", artifacts: [] },
    ];
    const dialog = await openFor();
    await within(dialog).findByTestId("deps-declared-x");
    const picker = within(dialog).getByTestId("deps-picker") as HTMLSelectElement;
    await waitFor(() => expect([...picker.options].map((o) => o.value)).toContain("old-one"));
    expect([...picker.options].map((o) => o.value)).not.toContain("SHELVED-qux");
  });

  it("#F5 an invalid file blocks Save until the replacement is confirmed explicitly", async () => {
    getBody = base({ declared: null, declaredError: "unknown top-level key `blocks`" });
    const dialog = await openFor();
    const save = (await within(dialog).findByTestId("deps-save")) as HTMLButtonElement;
    await within(dialog).findByTestId("deps-invalid");
    expect(save.disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId("deps-replace-confirm"));
    expect(save.disabled).toBe(false);
  });

  it("#F5 a 409 modified offers Reload, which re-reads the file", async () => {
    putStatus = { code: 409, body: { success: false, error: "changed", reason: "modified" } };
    const dialog = await openFor();
    await within(dialog).findByTestId("deps-declared-x");
    fireEvent.click(within(dialog).getByTestId("deps-save"));
    const reload = await within(dialog).findByTestId("deps-reload");
    const before = gets().length;
    fireEvent.click(reload);
    await waitFor(() => expect(gets().length).toBeGreaterThan(before));
  });

  it("#F5 a 409 locked offers Retry, which sends the PUT again", async () => {
    putStatus = { code: 409, body: { success: false, error: "busy", reason: "locked" } };
    const dialog = await openFor();
    await within(dialog).findByTestId("deps-declared-x");
    fireEvent.click(within(dialog).getByTestId("deps-save"));
    const retry = await within(dialog).findByTestId("deps-retry");
    putStatus = { code: 200, body: { success: true, data: { file: FILE } } };
    fireEvent.click(retry);
    await waitFor(() => expect(puts()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("deps-dialog")).toBeNull()); // saved → closes
  });

  it("#F6 the declare hint opens the dialog", async () => {
    const d: OpenSpecData = {
      initialized: true,
      changes: [{ name: "foo", status: "no-tasks", completedTasks: 0, totalTasks: 0, groupId: null, artifacts: [{ id: "dependencies", status: "ready" }],
        dependencies: { hasFile: false, blockedBy: [], blocks: [], related: [], overlaps: [], wave: 1, issues: [] } }],
    };
    render(<OpenSpecBoardView {...props({ data: d, sessions: [], openspecMap: new Map([["/p", d]]) })} />);
    fireEvent.click(screen.getByTestId("card-declare-dependencies-foo"));
    expect(await screen.findByTestId("deps-dialog")).toBeTruthy();
  });
});
