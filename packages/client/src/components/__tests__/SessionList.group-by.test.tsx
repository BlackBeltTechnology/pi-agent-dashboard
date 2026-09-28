/**
 * Session-list Group-by: lane rendering, header chip, folder-menu radio set,
 * lane collapse, hysteresis hold visual, selected-lane announcement, reveal,
 * and the no-re-partition-on-token-tick guard.
 * See change: session-list-group-by.
 */
import type { GroupByPrefs } from "@blackbelt-technology/pi-dashboard-shared/session-group-by.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import * as lanesModule from "../../lib/session/session-lanes.js";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

vi.mock("../../lib/session/session-lanes.js", async (orig) => {
  const actual = await orig<typeof import("../../lib/session/session-lanes.js")>();
  return { ...actual, partitionIntoLanes: vi.fn(actual.partitionIntoLanes) };
});

const CWD = "/home/user/repo";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mk(id: string, over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id,
    name: id,
    cwd: CWD,
    source: "tui",
    status: "idle",
    startedAt: 1000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...over,
  } as DashboardSession;
}

const prefs = (over: Partial<GroupByPrefs> = {}): GroupByPrefs => ({
  defaultGroupBy: "none",
  folderGroupBy: {},
  collapsedLanes: [],
  ...over,
});

type ListProps = React.ComponentProps<typeof SessionList>;

function List(props: Partial<ListProps> & { sessions: DashboardSession[] }) {
  return (
    <TestRouter>
      <ThemeProvider>
        <SessionList
          onSelect={() => {}}
          pinnedDirectories={[CWD]}
          onSetFolderGroupBy={() => {}}
          onSetLaneCollapsed={() => {}}
          sessionOrderMap={new Map([[CWD, props.sessions.map((s) => s.id)]])}
          {...props}
        />
      </ThemeProvider>
    </TestRouter>
  );
}

const statusMix = () => [
  mk("w1", { status: "streaming" }),
  mk("i1"),
  mk("n1", { currentTool: "ask_user" }),
  mk("r1", { unread: true }),
  mk("e1", { status: "ended" }),
];

describe("lane rendering", () => {
  it("none mode renders no lane chrome and no chip", () => {
    render(<List sessions={statusMix()} groupByPrefs={prefs()} />);
    expect(screen.queryByTestId(`lane-${CWD}::working`)).toBeNull();
    expect(screen.queryByTestId(`folder-group-by-chip-${CWD}`)).toBeNull();
  });

  it("status mode renders non-empty lanes in order needs-you, working, review, idle", () => {
    render(<List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} />);
    const lanes = Array.from(document.querySelectorAll("section[data-lane]")).map((el) => el.getAttribute("data-lane"));
    expect(lanes).toEqual(["needs-you", "working", "review", "idle"]);
    expect(screen.queryByTestId(`lane-${CWD}::error`)).toBeNull();
    const working = screen.getByTestId(`lane-cards-${CWD}::working`);
    expect(within(working).getByText("w1")).toBeTruthy();
    expect(screen.getByTestId(`lane-count-${CWD}::idle`).textContent).toBe("1");
    // Ended session never lands in a lane.
    expect(document.querySelector("section[data-lane] [data-session-id='e1']")).toBeNull();
  });

  it("lane label is never status-coloured; glyph carries the colour", () => {
    render(<List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} />);
    const toggle = screen.getByTestId(`lane-toggle-${CWD}::working`);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId(`lane-glyph-${CWD}::working`).getAttribute("style")).toContain("--status-working");
  });

  it("single non-empty lane renders the plain list but keeps the chip", () => {
    render(<List sessions={[mk("a"), mk("b")]} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "location" } })} />);
    expect(document.querySelector("section[data-lane]")).toBeNull();
    expect(screen.getByTestId(`folder-group-by-chip-${CWD}`).textContent).toContain("Location");
  });

  it("location mode: Main checkout · <branch> then Worktrees", () => {
    const wt = { mainPath: CWD, name: "feat-x" };
    render(
      <List
        sessions={[mk("m1", { gitBranch: "develop" }), mk("m2", { gitBranch: "develop" }), mk("w1", { gitWorktree: wt, cwd: `${CWD}/.worktrees/feat-x` })]}
        folderGitMap={new Map([[CWD, "develop"]])}
        groupByPrefs={prefs({ folderGroupBy: { [CWD]: "location" } })}
      />,
    );
    const lanes = Array.from(document.querySelectorAll("section[data-lane]")).map((el) => el.getAttribute("data-lane"));
    expect(lanes).toEqual(["main", "worktrees"]);
    expect(screen.getByTestId(`lane-toggle-${CWD}::main`).textContent).toContain("Main checkout");
    expect(screen.getByTestId(`lane-toggle-${CWD}::main`).textContent).toContain("develop");
    expect(screen.getByTestId(`lane-count-${CWD}::main`).textContent).toBe("2");
  });

  it("session search flattens lanes; clearing restores them", () => {
    render(<List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} />);
    fireEvent.change(screen.getByTestId("session-search-input"), { target: { value: "w1" } });
    expect(document.querySelector("section[data-lane]")).toBeNull();
    fireEvent.change(screen.getByTestId("session-search-input"), { target: { value: "" } });
    expect(document.querySelector("section[data-lane]")).toBeTruthy();
  });
});

describe("header chip + folder menu", () => {
  it("inherited mode shows '· default'; activating it opens the menu focused on the checked radio", () => {
    render(<List sessions={statusMix()} groupByPrefs={prefs({ defaultGroupBy: "status" })} />);
    const chip = screen.getByTestId(`folder-group-by-chip-${CWD}`);
    expect(chip.textContent).toContain("Status");
    expect(chip.textContent).toContain("default");
    fireEvent.click(chip);
    const checked = screen.getByTestId("folder-menu-radio-group-by-default");
    expect(checked.getAttribute("aria-checked")).toBe("true");
    expect(checked.textContent).toContain("Use default (Status)");
    expect(document.activeElement).toBe(checked);
  });

  it("chip stays visible when the folder is collapsed", () => {
    render(<List sessions={statusMix()} collapsedGroups={[CWD]} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} />);
    expect(screen.getByTestId(`folder-group-by-chip-${CWD}`).textContent).not.toContain("default");
  });

  it("selecting a mode sends the explicit target; Use default sends null", () => {
    const onSet = vi.fn();
    render(<List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "location" } })} onSetFolderGroupBy={onSet} />);
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    expect(screen.getByTestId("folder-menu-radio-group-by-location").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("folder-menu-radio-group-by-status"));
    expect(onSet).toHaveBeenLastCalledWith(CWD, "status");
    fireEvent.click(screen.getByTestId(`folder-actions-menu-${CWD}`));
    fireEvent.click(screen.getByTestId("folder-menu-radio-group-by-default"));
    expect(onSet).toHaveBeenLastCalledWith(CWD, null);
    expect(screen.queryByTestId("folder-menu-item-urgency-sort")).toBeNull();
  });
});

describe("lane collapse", () => {
  it("toggle sends the explicit target state; collapsed lane hides cards and keeps the count", () => {
    const onLane = vi.fn();
    const { rerender } = render(
      <List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} onSetLaneCollapsed={onLane} />,
    );
    fireEvent.click(screen.getByTestId(`lane-toggle-${CWD}::idle`));
    expect(onLane).toHaveBeenCalledWith(CWD, "idle", true);
    rerender(
      <List
        sessions={statusMix()}
        groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" }, collapsedLanes: [`${CWD}::idle`] })}
        onSetLaneCollapsed={onLane}
      />,
    );
    expect(screen.getByTestId(`lane-toggle-${CWD}::idle`).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId(`lane-cards-${CWD}::idle`)).toBeNull();
    expect(screen.getByTestId(`lane-count-${CWD}::idle`).textContent).toBe("1");
    // Status lanes show no rollup.
    expect(screen.queryByTestId(`lane-rollup-${CWD}::idle`)).toBeNull();
  });

  it("keyboard: Enter on the lane header toggles", () => {
    const onLane = vi.fn();
    render(<List sessions={statusMix()} groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" } })} onSetLaneCollapsed={onLane} />);
    const btn = screen.getByTestId(`lane-toggle-${CWD}::working`);
    btn.focus();
    fireEvent.click(btn); // native <button>: Enter/Space dispatch click
    expect(onLane).toHaveBeenCalledWith(CWD, "working", true);
  });

  it("collapsed location lane shows a status rollup", () => {
    const wt = { mainPath: CWD, name: "x" };
    render(
      <List
        sessions={[
          mk("m1"),
          mk("w1", { gitWorktree: wt, status: "streaming" }),
          mk("w2", { gitWorktree: wt, currentTool: "ask_user" }),
        ]}
        groupByPrefs={prefs({ folderGroupBy: { [CWD]: "location" }, collapsedLanes: [`${CWD}::worktrees`] })}
      />,
    );
    const rollup = screen.getByTestId(`lane-rollup-${CWD}::worktrees`);
    const segs = Array.from(rollup.querySelectorAll("[data-rollup-segment]")).map((el) => el.getAttribute("data-rollup-segment"));
    expect(segs).toEqual(["needs-you", "working"]);
  });

  it("collapsed lane holding the selected session shows the selected marker", () => {
    render(
      <List
        sessions={statusMix()}
        selectedId="i1"
        groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" }, collapsedLanes: [`${CWD}::idle`] })}
      />,
    );
    expect(screen.getByTestId(`lane-selected-marker-${CWD}::idle`)).toBeTruthy();
  });

  it("revealing a session in a collapsed lane expands that lane", () => {
    const onLane = vi.fn();
    render(
      <List
        sessions={statusMix()}
        revealRequest={{ sessionId: "i1", nonce: 1 }}
        onSeekToCard={() => {}}
        groupByPrefs={prefs({ folderGroupBy: { [CWD]: "status" }, collapsedLanes: [`${CWD}::idle`] })}
        onSetLaneCollapsed={onLane}
      />,
    );
    expect(onLane).toHaveBeenCalledWith(CWD, "idle", false);
  });
});

describe("hysteresis hold + announcement", () => {
  it("working → unread is held in Working with a destination-coloured countdown, then moves", () => {
    vi.useFakeTimers();
    const p = prefs({ folderGroupBy: { [CWD]: "status" } });
    const base = [mk("w1", { status: "streaming" }), mk("i1")];
    const { rerender } = render(<List sessions={base} groupByPrefs={p} selectedId="w1" />);
    const next = [mk("w1", { status: "idle", unread: true }), mk("i1")];
    rerender(<List sessions={next} groupByPrefs={p} selectedId="w1" />);
    const working = screen.getByTestId(`lane-cards-${CWD}::working`);
    expect(working.querySelector("[data-session-id='w1']")).toBeTruthy();
    const bar = screen.getByTestId("lane-hold-bar-w1");
    expect(bar.getAttribute("style")).toContain("--status-unread");
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByTestId(`lane-cards-${CWD}::review`).querySelector("[data-session-id='w1']")).toBeTruthy();
    expect(screen.queryByTestId("lane-hold-bar-w1")).toBeNull();
    expect(screen.getByTestId("lane-live-region").textContent).toBe("w1 moved to To review");
  });

  it("needs-you is immediate (no hold)", () => {
    const p = prefs({ folderGroupBy: { [CWD]: "status" } });
    const { rerender } = render(<List sessions={[mk("w1", { status: "streaming" }), mk("i1")]} groupByPrefs={p} />);
    rerender(<List sessions={[mk("w1", { status: "streaming", currentTool: "ask_user" }), mk("i1")]} groupByPrefs={p} />);
    expect(screen.getByTestId(`lane-cards-${CWD}::needs-you`).querySelector("[data-session-id='w1']")).toBeTruthy();
  });
});

describe("performance: no re-partition on token/cost ticks", () => {
  it("15 alive sessions — a token-only update does not call partitionIntoLanes", () => {
    const p = prefs({ folderGroupBy: { [CWD]: "status" } });
    const many = Array.from({ length: 15 }, (_, i) => mk(`s${i}`, { status: i % 3 === 0 ? "streaming" : "idle" }));
    const { rerender } = render(<List sessions={many} groupByPrefs={p} />);
    const spy = vi.mocked(lanesModule.partitionIntoLanes);
    spy.mockClear();
    rerender(<List sessions={many.map((s) => ({ ...s, tokensIn: (s.tokensIn ?? 0) + 100, cost: 1.5 }))} groupByPrefs={p} />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<List sessions={many.map((s, i) => (i === 1 ? { ...s, status: "streaming" as const } : s))} groupByPrefs={p} />);
    expect(spy).toHaveBeenCalled();
  });

  it("location mode — a status-only change does not re-partition", () => {
    const p = prefs({ folderGroupBy: { [CWD]: "location" } });
    const wt = { mainPath: CWD, name: "x" };
    const many = Array.from({ length: 6 }, (_, i) => mk(`s${i}`, i % 2 ? { gitWorktree: wt } : {}));
    const { rerender } = render(<List sessions={many} groupByPrefs={p} />);
    const spy = vi.mocked(lanesModule.partitionIntoLanes);
    spy.mockClear();
    rerender(<List sessions={many.map((s, i) => (i === 0 ? { ...s, status: "streaming" as const, unread: true } : s))} groupByPrefs={p} />);
    expect(spy).not.toHaveBeenCalled();
  });
});
