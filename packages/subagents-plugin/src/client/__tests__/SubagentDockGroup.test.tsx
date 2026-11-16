/**
 * SubagentDockGroup — the subagents plugin's `composer-dock-process-group` claim.
 * Rows mode lists running + pending subagents via `ComposerDockRow`; summary
 * mode renders no DOM and reports `{ count, noun }`.
 *
 * See change: add-composer-dock (task 3.3, test-plan #E25).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentState } from "../types.js";

let subagents: ReadonlyMap<string, SubagentState> = new Map();

vi.mock("@blackbelt-technology/dashboard-plugin-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/dashboard-plugin-runtime")>()),
  useSessionSubagents: () => subagents,
}));

const { SubagentDockGroup } = await import("../SubagentDockGroup.js");

const NOW = new Date("2026-01-01T00:00:00.000Z").getTime();
const session = { id: "s1", cwd: "/repo", source: "tui", status: "active", startedAt: 0 } as DashboardSession;

function sub(over: Partial<SubagentState> & { id: string }): SubagentState {
  return { type: "Explore", description: "Map the repo", status: "running", ...over };
}

function mapOf(...states: SubagentState[]): ReadonlyMap<string, SubagentState> {
  return new Map(states.map((s) => [s.id, s]));
}

function renderGroup(mode: "summary" | "rows", reportSummary = vi.fn()) {
  const view = render(
    <SubagentDockGroup session={session} pluginContext={{}} mode={mode} reportSummary={reportSummary} />,
  );
  return { ...view, reportSummary };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  subagents = new Map();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SubagentDockGroup — rows mode", () => {
  it("renders a running subagent: name, task, role · steps, elapsed, Open link", () => {
    subagents = mapOf(
      sub({
        id: "a1",
        displayName: "explorer",
        description: "Map the repo",
        startedAt: NOW - 12_000,
        entries: [
          { kind: "text", text: "a", ts: 1 },
          { kind: "text", text: "b", ts: 2 },
          { kind: "text", text: "c", ts: 3 },
        ],
      }),
    );
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-title").textContent).toBe("explorer");
    expect(screen.getByTestId("composer-dock-row-detail").textContent).toBe("Map the repo");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Explore · 3 steps");
    expect(screen.getByTestId("composer-dock-row-elapsed").textContent).toBe("12s");
    const open = screen.getByRole("link", { name: /Open subagent explorer/ });
    expect(open.getAttribute("href")).toBe("/session/s1/subagent/a1");
  });

  it("marks a not-yet-started subagent `pending` with no elapsed time (#E25)", () => {
    subagents = mapOf(sub({ id: "a2", status: "created", displayName: "queued-one" }));
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("pending");
    expect(screen.queryByTestId("composer-dock-row-elapsed")).toBeNull();
    expect(screen.getByRole("link", { name: /Open subagent queued-one/ }).getAttribute("href")).toBe(
      "/session/s1/subagent/a2",
    );
  });

  it("falls back to the type for the name and omits steps when there are none", () => {
    subagents = mapOf(sub({ id: "a3", type: "general-purpose", startedAt: NOW }));
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-title").textContent).toBe("general-purpose");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("general-purpose");
  });

  it("lists only running and pending subagents, once each even when dual-indexed", () => {
    const running = sub({ id: "a1", agentSessionId: "sess-a1", startedAt: NOW });
    subagents = new Map<string, SubagentState>([
      ["a1", running],
      ["sess-a1", running],
      ["a2", sub({ id: "a2", status: "completed" })],
      ["a3", sub({ id: "a3", status: "failed" })],
      ["a4", sub({ id: "a4", status: "created" })],
    ]);
    renderGroup("rows");
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(2);
  });

  // See change: subagent-queue-visibility (review B3, test-plan #E11).
  it("shows a queued subagent as waiting: `#n in queue`, no run timer", () => {
    subagents = mapOf(
      sub({ id: "q1", status: "running", queuePosition: 2, startedAt: NOW - 30_000, displayName: "waiter" }),
      sub({ id: "q2", status: "created", queuePosition: 1 }),
    );
    renderGroup("rows");
    const metas = screen.getAllByTestId("composer-dock-row-meta").map((m) => m.textContent);
    expect(metas).toEqual(["#2 in queue", "#1 in queue"]);
    expect(screen.queryByTestId("composer-dock-row-elapsed")).toBeNull();
  });

  it("a running subagent whose slot was granted is no longer shown as queued", () => {
    subagents = mapOf(sub({ id: "r1", status: "running", queuePosition: 0, slotGrantedAt: NOW - 5_000, startedAt: NOW - 60_000 }));
    renderGroup("rows");
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Explore");
    // Run time counts from the slot grant, not from the call (spec: wait is not run time).
    expect(screen.getByTestId("composer-dock-row-elapsed").textContent).toBe("5s");
  });

  it("a stopped subagent leaves the Processes lane like any finished one", () => {
    subagents = mapOf(sub({ id: "s1", status: "stopped", stopReason: "queued" }), sub({ id: "a1", startedAt: NOW }));
    renderGroup("rows");
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(1);
  });

  it("renders nothing with zero subagents", () => {
    const { container } = renderGroup("rows");
    expect(container.innerHTML).toBe("");
  });
});

describe("SubagentDockGroup — summary mode", () => {
  it("renders no DOM and reports the active count", () => {
    subagents = mapOf(sub({ id: "a1" }), sub({ id: "a2", status: "created" }), sub({ id: "a3", status: "completed" }));
    const { container, reportSummary } = renderGroup("summary");
    expect(container.innerHTML).toBe("");
    expect(reportSummary).toHaveBeenCalledTimes(1);
    expect(reportSummary).toHaveBeenCalledWith({ count: 2, noun: "subagents" });
  });

  it("agrees the noun with the count (1 → subagent)", () => {
    subagents = mapOf(sub({ id: "a1" }));
    const { reportSummary } = renderGroup("summary");
    expect(reportSummary).toHaveBeenCalledWith({ count: 1, noun: "subagent" });
  });

  it("reports null with zero subagents", () => {
    const { container, reportSummary } = renderGroup("summary");
    expect(container.innerHTML).toBe("");
    expect(reportSummary).toHaveBeenCalledTimes(1);
    expect(reportSummary).toHaveBeenCalledWith(null);
  });

  it("re-reports on a count change but not on an unrelated re-render", () => {
    subagents = mapOf(sub({ id: "a1" }));
    const reportSummary = vi.fn();
    const { rerender } = renderGroup("summary", reportSummary);
    // A fresh `reportSummary` identity per render must not loop or re-report.
    rerender(
      <SubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={(s) => reportSummary(s)} />,
    );
    expect(reportSummary).toHaveBeenCalledTimes(1);
    subagents = mapOf(sub({ id: "a1" }), sub({ id: "a2" }));
    rerender(
      <SubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={(s) => reportSummary(s)} />,
    );
    expect(reportSummary).toHaveBeenCalledTimes(2);
    expect(reportSummary).toHaveBeenLastCalledWith({ count: 2, noun: "subagents" });
  });

  it("starts no ticking timer (no DOM, no elapsed)", () => {
    subagents = mapOf(sub({ id: "a1", startedAt: NOW }));
    renderGroup("summary");
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// See change: show-background-subagents-in-dock (groups 3–4, design D3, D4).
// ---------------------------------------------------------------------------
const { BackgroundSubagentDockGroup, SubagentDockRow, DOCK_STOP_BUTTON_CLASS } = await import("../SubagentDockGroup.js");
const stopStore = await import("../subagentStop.js");
const { act, fireEvent } = await import("@testing-library/react");
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const { dirname, join } = await import("node:path");

type BgState = SubagentState & { background?: true };
const bgSub = (over: Partial<SubagentState> & { id: string }): BgState => ({ ...sub(over), background: true });

function renderBoth(mode: "summary" | "rows") {
  const fg = vi.fn();
  const bg = vi.fn();
  const view = render(
    <>
      <SubagentDockGroup session={session} pluginContext={{}} mode={mode} reportSummary={fg} />
      <BackgroundSubagentDockGroup session={session} pluginContext={{}} mode={mode} reportSummary={bg} />
    </>,
  );
  return { ...view, fg, bg };
}

describe("foreground + background groups — summary counts (#E4)", () => {
  it.each([
    [0, null, null],
    [1, { count: 1, noun: "subagent" }, { count: 1, noun: "background subagent" }],
    [2, { count: 2, noun: "subagents" }, { count: 2, noun: "background subagents" }],
  ])("%i of each kind", (n, fgExpected, bgExpected) => {
    const states: SubagentState[] = [];
    for (let i = 0; i < n; i++) states.push(sub({ id: `f${i}` }), bgSub({ id: `b${i}` }));
    subagents = mapOf(...states);
    const { fg, bg } = renderBoth("summary");
    expect(fg).toHaveBeenLastCalledWith(fgExpected);
    expect(bg).toHaveBeenLastCalledWith(bgExpected);
  });

  it("a background subagent failed by the session-end heal leaves the group (#X2)", () => {
    subagents = mapOf(bgSub({ id: "docs-writer", status: "failed", error: "parent session ended", healedBy: "session_ended" }));
    const { bg } = renderBoth("summary");
    expect(bg).toHaveBeenLastCalledWith(null);
  });
});

describe("foreground + background groups — rows (#E5)", () => {
  it("each live subagent sits in exactly one group; terminal ones in neither", () => {
    subagents = mapOf(
      sub({ id: "fg-run", displayName: "fg-run", startedAt: NOW - 1000, entries: [{ kind: "text", text: "secret step", ts: 1 }] }),
      bgSub({ id: "bg-run", displayName: "bg-run", startedAt: NOW - 2000 }),
      bgSub({ id: "bg-new", displayName: "bg-new", status: "created" }),
      bgSub({ id: "bg-done", displayName: "bg-done", status: "completed" }),
      sub({ id: "fg-fail", displayName: "fg-fail", status: "failed" }),
    );
    const fgView = render(<SubagentDockGroup session={session} pluginContext={{}} mode="rows" reportSummary={vi.fn()} />);
    const fgTitles = fgView.getAllByTestId("composer-dock-row-title").map((e) => e.textContent);
    expect(fgTitles).toEqual(["fg-run"]);
    expect(fgView.getByTestId("composer-dock-row-meta").textContent).toBe("Explore · 1 step");
    expect(fgView.container.textContent).not.toContain("secret step");
    fgView.unmount();
    const bgView = render(<BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="rows" reportSummary={vi.fn()} />);
    const bgTitles = bgView.getAllByTestId("composer-dock-row-title").map((e) => e.textContent);
    expect(bgTitles).toEqual(["bg-run", "bg-new"]);
    const metas = bgView.getAllByTestId("composer-dock-row-meta").map((e) => e.textContent);
    expect(metas).toEqual(["Explore", "pending"]);
    expect(bgView.getAllByTestId("composer-dock-row-elapsed")).toHaveLength(1);
    expect(bgView.getAllByRole("link", { name: /Open subagent/ })).toHaveLength(2);
  });
});

function renderRow(s: SubagentState) {
  return render(<SubagentDockRow sessionId="s1" sub={s} />);
}

describe("dock row Stop — visibility (#E6) and older producer (#X4)", () => {
  const statuses = ["created", "running", "completed", "failed", "stopped"] as const;
  const stoppables = [true, false, undefined] as const;
  const cells = statuses.flatMap((status) => stoppables.map((stoppable) => [status, stoppable] as const));
  it.each(cells)("status %s × stoppable %s", (status, stoppable) => {
    renderRow(sub({ id: "x", status, ...(stoppable === undefined ? {} : { stoppable }) }));
    const stop = screen.queryByRole("button", { name: /Stop subagent|Remove subagent/ });
    const expected = (status === "created" || status === "running") && stoppable === true;
    expect(Boolean(stop)).toBe(expected);
    expect(screen.getByRole("link", { name: /Open subagent/ })).toBeTruthy();
  });

  it("#X4 without `stoppable`: Open is the only action and nothing posts", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      renderRow(sub({ id: "x", displayName: "old" }));
      expect(screen.queryAllByRole("button")).toHaveLength(0);
      fireEvent.click(screen.getByRole("link", { name: /Open subagent old/ }));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("dock row Stop — wording (#E7)", () => {
  it.each([
    ["running, no queue position", { status: "running" as const }, "Stop subagent docs-writer"],
    ["running, queuePosition 2", { status: "running" as const, queuePosition: 2 }, "Remove subagent docs-writer from queue"],
    ["running, queuePosition 0", { status: "running" as const, queuePosition: 0 }, "Stop subagent docs-writer"],
    ["created", { status: "created" as const }, "Remove subagent docs-writer from queue"],
  ])("%s", (_label, over, name) => {
    renderRow(sub({ id: "dw", displayName: "docs-writer", stoppable: true, ...over }));
    const button = screen.getByRole("button", { name });
    expect(button.textContent).toBe("Stop");
  });
});

describe("dock row Stop — feedback (#F2, #F3)", () => {
  const dw = () => bgSub({ id: "dw", displayName: "docs-writer", stoppable: true, startedAt: NOW, entries: [{ kind: "text", text: "a", ts: 1 }] });
  beforeEach(() => stopStore.__resetSubagentStopsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("(a) Stopping… + disabled, then the row leaves on the stopped frame", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    subagents = mapOf(dw());
    const { rerender } = render(<BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="rows" reportSummary={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
    expect((screen.getByRole("button", { name: "Stop subagent docs-writer" }) as HTMLButtonElement).disabled).toBe(true);
    subagents = mapOf({ ...dw(), status: "stopped", stopReason: "running" });
    rerender(<BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="rows" reportSummary={vi.fn()} />);
    expect(screen.queryByTestId("composer-dock-row")).toBeNull();
  });

  it("(b) a refused stop reads Stop failed and re-enables Stop", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchSpy);
    renderRow(dw());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stop failed");
    expect((screen.getByRole("button", { name: "Stop subagent docs-writer" }) as HTMLButtonElement).disabled).toBe(false);
    // Only the per-subagent route was called: never a session abort.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as unknown[])[0]).toBe("/api/plugins/subagents/stop");
  });

  it("(c) no frame: Stopping… at 9 999 ms, Still running + enabled at 10 000 ms", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    renderRow(dw());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Still running");
    expect((screen.getByRole("button", { name: "Stop subagent docs-writer" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("#F3 a pending stop shows on the background dock row", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    void stopStore.requestSubagentStop("s1", "dw");
    renderRow(dw());
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
  });
});

describe("summary-mode terminal clear (#F4)", () => {
  beforeEach(() => {
    stopStore.__resetSubagentStopsForTests();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => vi.unstubAllGlobals());

  const phaseOf = (agentId: string) => {
    let phase: string | undefined;
    function Probe() {
      phase = stopStore.useSubagentStopState("s1", agentId)?.phase;
      return null;
    }
    render(<Probe />).unmount();
    return phase;
  };

  it("(a) only the terminal background subagent's entry is cleared", () => {
    void stopStore.requestSubagentStop("s1", "C094");
    void stopStore.requestSubagentStop("s1", "dw");
    subagents = mapOf(sub({ id: "C094", stoppable: true }), bgSub({ id: "dw", stoppable: true }));
    const { rerender } = renderBoth("summary");
    expect(phaseOf("dw")).toBe("pending");
    subagents = mapOf(sub({ id: "C094", stoppable: true }), bgSub({ id: "dw", status: "stopped", stoppable: true }));
    rerender(
      <>
        <SubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={vi.fn()} />
        <BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={vi.fn()} />
      </>,
    );
    expect(phaseOf("dw")).toBeUndefined();
    expect(phaseOf("C094")).toBe("pending");
  });

  it("(b) unmounting rows mode with both still running clears nothing", () => {
    void stopStore.requestSubagentStop("s1", "C094");
    void stopStore.requestSubagentStop("s1", "dw");
    subagents = mapOf(sub({ id: "C094", stoppable: true }), bgSub({ id: "dw", stoppable: true }));
    renderBoth("rows").unmount();
    expect(phaseOf("dw")).toBe("pending");
    expect(phaseOf("C094")).toBe("pending");
  });
});

describe("Stop button classes match the shell's Kill button (4.8)", () => {
  it("copies ACTION_BUTTON + KILL_BUTTON from ProcessesLaneBody.tsx verbatim", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../client/src/components/chat/ProcessesLaneBody.tsx"),
      "utf8",
    );
    const action = /const ACTION_BUTTON =\s*"([^"]+)";/.exec(src)?.[1];
    const kill = /const KILL_BUTTON = `\$\{ACTION_BUTTON\} ([^`]+)`;/.exec(src)?.[1];
    expect(action).toBeTruthy();
    expect(kill).toBeTruthy();
    expect(DOCK_STOP_BUTTON_CLASS).toBe(`${action} ${kill}`);
    renderRow(sub({ id: "dw", displayName: "docs-writer", stoppable: true }));
    expect(screen.getByRole("button", { name: "Stop subagent docs-writer" }).className).toBe(DOCK_STOP_BUTTON_CLASS);
  });
});

// ---------------------------------------------------------------------------
// Ghost rows cleared by the session's stop answer (test-plan #F1, #F2, #X1 client half).
// See change: fix-background-subagent-ghost-rows.
// ---------------------------------------------------------------------------
const { toolRowFinalizers } = await import("../toolRowFinalizer.js");

describe("ghost row cleared by the stop answer (#F1, #F2, #X1)", () => {
  const dw = () => bgSub({ id: "dw", displayName: "docs-writer", stoppable: true, startedAt: NOW });
  /** Reduce `subagent_stop_result {phase:"unknown"}` through the real finalizer into the mocked map. */
  const reduceUnknownAnswer = () => {
    const state = { subagents: new Map(subagents), messages: [], toolCalls: new Map() };
    const next = toolRowFinalizers[0].onSessionEvent!(state, {
      eventType: "subagent_stop_result",
      timestamp: NOW + 1,
      data: { agentId: "dw", outcome: "ignored", phase: "unknown", answeredAt: NOW },
    })!;
    subagents = next.subagents;
  };
  const both = () => (
    <>
      <BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="summary" reportSummary={vi.fn()} />
      <BackgroundSubagentDockGroup session={session} pluginContext={{}} mode="rows" reportSummary={vi.fn()} />
    </>
  );
  const stopPhase = () => {
    let phase: string | undefined;
    function Probe() {
      phase = stopStore.useSubagentStopState("s1", "dw")?.phase;
      return null;
    }
    render(<Probe />).unmount();
    return phase;
  };
  beforeEach(() => {
    stopStore.__resetSubagentStopsForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("#F1 a pending stop: the unknown answer removes the row and clears the stop", async () => {
    subagents = mapOf(dw());
    const { rerender } = render(both());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
    reduceUnknownAnswer();
    rerender(both());
    expect(screen.queryByTestId("composer-dock-row")).toBeNull();
    expect(screen.queryByText("Stopping…")).toBeNull();
    expect(screen.queryByText("Still running")).toBeNull();
    expect(stopPhase()).toBeUndefined();
  });

  it("#F2 after Still running, a late unknown answer still removes the row", async () => {
    subagents = mapOf(dw());
    const { rerender } = render(both());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Still running");
    reduceUnknownAnswer();
    rerender(both());
    expect(screen.queryByTestId("composer-dock-row")).toBeNull();
  });

  it("#X1 no answer (producer 0.7.0): Stopping… then Still running, exactly as today", async () => {
    subagents = mapOf(dw());
    render(both());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop subagent docs-writer" }));
    });
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Stopping…");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("composer-dock-row-meta").textContent).toBe("Still running");
    expect(screen.getByTestId("composer-dock-row")).toBeTruthy();
  });
});
