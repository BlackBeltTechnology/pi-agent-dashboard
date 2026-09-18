/**
 * Task 2.5 for change: fix-stuck-tool-card-on-dropped-event.
 *
 * - dropped-terminal reconciles (HTTP 200 → card flips to complete/error)
 * - genuinely slow tool is NOT falsely completed (HTTP 404 → row stays running)
 * - evicted result (HTTP 404) leaves the row running (known limitation)
 * - pure `selectStaleRunningTools` scan semantics
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../../lib/chat/event-reducer.js";
import {
  pruneInactiveKeys,
  RECONCILE_POLL_MS,
  STALE_TOOL_MS,
  SUPERSEDE_MIN_404,
  selectActiveToolKeys,
  selectStaleRunningTools,
  selectSupersededHealTargets,
  synthesizeToolEndEvent,
  useStaleToolReconcile,
} from "../useStaleToolReconcile.js";

function runningToolState(toolCallId: string, startedAt: number): SessionState {
  const s = createInitialState();
  s.toolCalls.set(toolCallId, {
    toolCallId,
    toolName: "Read",
    args: { path: "foo.ts" },
    status: "running",
    startedAt,
  });
  s.messages.push({
    id: `tool-${toolCallId}`,
    role: "toolResult",
    content: "Read",
    toolName: "Read",
    toolCallId,
    toolStatus: "running",
    timestamp: startedAt,
    startedAt,
  });
  return s;
}

type ToolStatus = "running" | "complete" | "error" | "elided";

/** A session state carrying one tool row per entry, all still present in `toolCalls`. */
function toolRowsState(rows: Array<{ id: string; status: ToolStatus }>, startedAt = 0): SessionState {
  const s = createInitialState();
  for (const { id, status } of rows) {
    s.toolCalls.set(id, { toolCallId: id, toolName: "Read", args: { path: "foo.ts" }, status, startedAt });
    s.messages.push({
      id: `tool-${id}`,
      role: "toolResult",
      content: "Read",
      toolName: "Read",
      toolCallId: id,
      toolStatus: status,
      timestamp: startedAt,
      startedAt,
    });
  }
  return s;
}

describe("selectStaleRunningTools", () => {
  const noSkip = () => false;

  it("returns running rows older than staleMs", () => {
    const states = new Map([["s1", runningToolState("t1", 0)]]);
    expect(selectStaleRunningTools(states, STALE_TOOL_MS + 1, STALE_TOOL_MS, noSkip)).toEqual([
      { sessionId: "s1", toolCallId: "t1" },
    ]);
  });

  it("excludes rows younger than staleMs", () => {
    const states = new Map([["s1", runningToolState("t1", 0)]]);
    expect(selectStaleRunningTools(states, STALE_TOOL_MS - 1, STALE_TOOL_MS, noSkip)).toEqual([]);
  });

  it("excludes non-running rows", () => {
    const s = runningToolState("t1", 0);
    s.toolCalls.get("t1")!.status = "complete";
    const states = new Map([["s1", s]]);
    expect(selectStaleRunningTools(states, STALE_TOOL_MS + 1, STALE_TOOL_MS, noSkip)).toEqual([]);
  });

  it("honors skip predicate", () => {
    const states = new Map([["s1", runningToolState("t1", 0)]]);
    const skip = (key: string) => key === "s1:t1";
    expect(selectStaleRunningTools(states, STALE_TOOL_MS + 1, STALE_TOOL_MS, skip)).toEqual([]);
  });
});

describe("synthesizeToolEndEvent", () => {
  it("stamps toolCallId, coerces result to string, maps isError", () => {
    const e = synthesizeToolEndEvent("t1", { result: "ok", isError: false }, 5000);
    expect(e.eventType).toBe("tool_execution_end");
    expect(e.timestamp).toBe(5000);
    expect(e.data).toEqual({ toolCallId: "t1", result: "ok", isError: false });
  });

  it("marks error result", () => {
    const e = synthesizeToolEndEvent("t1", { result: "boom", isError: true }, 1);
    expect(e.data.isError).toBe(true);
  });

  it("coerces missing result to empty string", () => {
    const e = synthesizeToolEndEvent("t1", {}, 1);
    expect(e.data.result).toBe("");
  });
});

/**
 * A stuck row whose emitting inference has been superseded by a LATER assistant
 * `message_start` (the supersede proof). Tool `startedAt` = 0 so `setSystemTime`
 * past STALE_TOOL_MS makes it stale.
 */
function supersededStuckState(toolCallId: string): SessionState {
  const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
    eventType: eventType as DashboardEvent["eventType"],
    timestamp: 0,
    data,
  });
  let s = createInitialState();
  s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }));
  s = reduceEvent(s, ev("tool_execution_start", { toolCallId, toolName: "Read", args: {} }));
  // tool_execution_end withheld (dropped/evicted) — row stays running.
  s = reduceEvent(s, ev("message_end", { message: { role: "assistant", content: [] } }));
  s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }));
  return s;
}

describe("selectSupersededHealTargets", () => {
  const always = () => SUPERSEDE_MIN_404;
  const never = () => 0;

  it("selects a running row with ≥ min404 AND a later inference", () => {
    const states = new Map([["s1", supersededStuckState("t1")]]);
    expect(selectSupersededHealTargets(states, SUPERSEDE_MIN_404, always)).toEqual([
      { sessionId: "s1", toolCallId: "t1" },
    ]);
  });

  it("excludes rows below the 404 threshold (recovery not yet exhausted)", () => {
    const states = new Map([["s1", supersededStuckState("t1")]]);
    expect(selectSupersededHealTargets(states, SUPERSEDE_MIN_404, never)).toEqual([]);
  });

  it("excludes a row with no later inference (parallel/active turn)", () => {
    // Same start but NO second assistant message_start → proof absent.
    const ev = (eventType: string, data: Record<string, unknown>): DashboardEvent => ({
      eventType: eventType as DashboardEvent["eventType"],
      timestamp: 0,
      data,
    });
    let s = createInitialState();
    s = reduceEvent(s, ev("message_start", { message: { role: "assistant", content: [] } }));
    s = reduceEvent(s, ev("tool_execution_start", { toolCallId: "t1", toolName: "Read", args: {} }));
    const states = new Map([["s1", s]]);
    expect(selectSupersededHealTargets(states, SUPERSEDE_MIN_404, always)).toEqual([]);
  });
});

function useHarness(initial: Map<string, SessionState>) {
  const [states, setStates] = useState(initial);
  useStaleToolReconcile(states, setStates, "");
  return states;
}

/**
 * E10 — `selectActiveToolKeys` is the prune's notion of "active". It MUST key
 * on `status === "running"`, NOT on row presence: `event-reducer.ts` never
 * evicts tool rows, so a presence-based selector would yield every tool call
 * ever executed and the prune would delete nothing (design D3).
 */
describe("selectActiveToolKeys (E10)", () => {
  it("yields exactly the running rows' keys while terminal rows remain present", () => {
    const states = new Map([
      [
        "s1",
        toolRowsState([
          { id: "r1", status: "running" },
          { id: "r2", status: "running" },
          { id: "c1", status: "complete" },
          { id: "e1", status: "error" },
          { id: "l1", status: "elided" },
        ]),
      ],
      [
        "s2",
        toolRowsState([
          { id: "r3", status: "running" },
          { id: "c2", status: "complete" },
          { id: "c3", status: "complete" },
          { id: "e2", status: "error" },
          { id: "l2", status: "elided" },
        ]),
      ],
    ]);

    // All 10 rows remain in `toolCalls`…
    const present = [...states.values()].flatMap((s) => [...s.toolCalls.keys()]);
    expect(present).toHaveLength(10);
    // …but only the 3 running rows are active.
    expect(selectActiveToolKeys(states)).toEqual(new Set(["s1:r1", "s1:r2", "s2:r3"]));
  });

  it("returns an empty set when no row is running", () => {
    const states = new Map([["s1", toolRowsState([{ id: "c1", status: "complete" }])]]);
    expect(selectActiveToolKeys(states)).toEqual(new Set());
  });
});

/**
 * E11/X4/P1 — the prune a reconcile tick runs before scanning: every
 * bookkeeping key whose row is not currently `running` is discarded even though
 * the row itself stays present in `toolCalls`.
 */
describe("reconcile bookkeeping prune (E11, E12, X4, P1)", () => {
  const sortedKeys = (m: Map<string, unknown>) => [...m.keys()].sort();

  function bookkeepingFor(states: Map<string, SessionState>, value: number) {
    const lastAttempt = new Map<string, number>();
    const count404 = new Map<string, number>();
    for (const [sessionId, state] of states) {
      for (const toolCallId of state.toolCalls.keys()) {
        lastAttempt.set(`${sessionId}:${toolCallId}`, value);
        count404.set(`${sessionId}:${toolCallId}`, value);
      }
    }
    return { lastAttempt, count404 };
  }

  // E11
  it("retains only the running keys in both maps", () => {
    const states = new Map([
      [
        "s1",
        toolRowsState([
          { id: "r1", status: "running" },
          { id: "r2", status: "running" },
          { id: "r3", status: "running" },
          { id: "c1", status: "complete" },
          { id: "c2", status: "complete" },
          { id: "e1", status: "error" },
          { id: "e2", status: "error" },
          { id: "l1", status: "elided" },
          { id: "l2", status: "elided" },
          { id: "c3", status: "complete" },
        ]),
      ],
    ]);
    const { lastAttempt, count404 } = bookkeepingFor(states, 1000);
    expect(lastAttempt.size).toBe(10);

    const active = selectActiveToolKeys(states);
    pruneInactiveKeys(lastAttempt, active);
    pruneInactiveKeys(count404, active);

    expect(sortedKeys(lastAttempt)).toEqual(["s1:r1", "s1:r2", "s1:r3"]);
    expect(sortedKeys(count404)).toEqual(["s1:r1", "s1:r2", "s1:r3"]);
  });

  // E12
  it("keeps a still-running row's last-attempt time and 404 count unchanged", () => {
    const states = new Map([
      [
        "s1",
        toolRowsState([
          { id: "live", status: "running" },
          { id: "done", status: "complete" },
        ]),
      ],
    ]);
    const lastAttempt = new Map([
      ["s1:live", 4242],
      ["s1:done", 1],
    ]);
    const count404 = new Map([
      ["s1:live", 2],
      ["s1:done", 5],
    ]);

    const active = selectActiveToolKeys(states);
    pruneInactiveKeys(lastAttempt, active);
    pruneInactiveKeys(count404, active);

    expect(lastAttempt.get("s1:live")).toBe(4242);
    expect(count404.get("s1:live")).toBe(2);
    expect(lastAttempt.has("s1:done")).toBe(false);
    expect(count404.has("s1:done")).toBe(false);
  });

  // X4
  it("discards a key a late 404 response re-inserted for a since-terminal row", () => {
    const states = new Map([
      [
        "s1",
        toolRowsState([
          { id: "running", status: "running" },
          // Went terminal while its reconcile request was still in flight.
          { id: "late", status: "complete" },
        ]),
      ],
    ]);
    const count404 = new Map([["s1:running", 2]]);
    const active = selectActiveToolKeys(states);

    // The tick's prune drops the since-terminal key…
    pruneInactiveKeys(count404, active);
    expect(count404.has("s1:late")).toBe(false);

    // …then the in-flight 404 response lands and re-inserts it.
    count404.set("s1:late", 1);
    expect(count404.has("s1:late")).toBe(true);

    // The NEXT tick discards it again — retained entries return to the
    // currently-running row count.
    pruneInactiveKeys(count404, active);
    expect(sortedKeys(count404)).toEqual(["s1:running"]);
    expect(count404.size).toBe(active.size);
  });

  // P1
  it("soak: 5000 rows each run→terminal retain only the running bookkeeping", () => {
    const RUNNING = 10;
    const TOTAL = 5000;
    const rows: Array<{ id: string; status: ToolStatus }> = Array.from({ length: TOTAL }, (_, i) => ({
      id: `t${i}`,
      status: "running",
    }));
    const states = new Map([["s1", toolRowsState(rows)]]);
    const { lastAttempt, count404 } = bookkeepingFor(states, 1);
    expect(lastAttempt.size).toBe(TOTAL);

    // Drive ticks while every non-running row transitions run→terminal in
    // batches; the rows themselves stay present throughout.
    let terminalized = 0;
    for (let tick = 0; tick < 200 && terminalized < TOTAL - RUNNING; tick++) {
      for (let i = 0; i < 50 && terminalized < TOTAL - RUNNING; i++, terminalized++) {
        states.get("s1")!.toolCalls.get(`t${terminalized}`)!.status = "complete";
      }
      const active = selectActiveToolKeys(states);
      pruneInactiveKeys(lastAttempt, active);
      pruneInactiveKeys(count404, active);
    }

    // Every row is still present…
    expect(states.get("s1")!.toolCalls.size).toBe(TOTAL);
    // …yet the bookkeeping is proportional to the running rows, not the
    // 5000 tool calls ever executed.
    expect(lastAttempt.size).toBe(RUNNING);
    expect(count404.size).toBe(RUNNING);
  });
});

describe("useStaleToolReconcile hook", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reconciles a dropped terminal event on HTTP 200 (card flips to complete)", async () => {
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: "healed output", isError: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", runningToolState("t1", 0)]]);
    const { result } = renderHook(() => useHarness(initial));

    expect(result.current.get("s1")!.toolCalls.get("t1")!.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/s1/tool-result/t1");
    const tc = result.current.get("s1")!.toolCalls.get("t1")!;
    expect(tc.status).toBe("complete");
    const row = result.current.get("s1")!.messages.find((m) => m.toolCallId === "t1");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.result).toBe("healed output");
  });

  it("does NOT falsely complete a genuinely slow tool on HTTP 404", async () => {
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "tool call still in flight or unknown" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", runningToolState("t1", 0)]]);
    const { result } = renderHook(() => useHarness(initial));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Row remains running — no synthesized completion.
    expect(result.current.get("s1")!.toolCalls.get("t1")!.status).toBe("running");
  });

  it("finalizes an unrecoverable-but-superseded card after repeated 404s", async () => {
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "evicted" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", supersededStuckState("t1")]]);
    const { result } = renderHook(() => useHarness(initial));
    expect(result.current.get("s1")!.toolCalls.get("t1")!.status).toBe("running");

    // Drive several poll+re-arm cycles so ≥ SUPERSEDE_MIN_404 404s accrue and a
    // subsequent tick fires the supersede heal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * (STALE_TOOL_MS + RECONCILE_POLL_MS));
    });

    const tc = result.current.get("s1")!.toolCalls.get("t1")!;
    expect(tc.status).toBe("complete");
    const row = result.current.get("s1")!.messages.find((m) => m.toolCallId === "t1");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.toolDetails?.healedBy).toBe("superseded");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[supersede-heal]"));
  });

  it("re-arms after a 404 rather than probing every tick", async () => {
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "evicted" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", runningToolState("t1", 0)]]);
    renderHook(() => useHarness(initial));

    // First tick probes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second tick within the re-arm window must NOT probe again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("prunes a terminal row's re-arm bookkeeping on the tick (E11 wiring)", async () => {
    // A row that reaches terminal and then runs again under the SAME toolCallId
    // must not inherit the previous lifetime's REARM window. The row stays
    // present in `toolCalls` throughout, so only the per-tick prune can drop its
    // `lastAttempt` entry — a presence-based prune would never fire.
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "evicted" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", runningToolState("t1", 0)]]);
    const { result, rerender } = renderHook(() => useHarness(initial));

    // Tick 1: the stale running row is probed; a re-arm entry is recorded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The row reaches terminal — still PRESENT in toolCalls.
    act(() => {
      result.current.get("s1")!.toolCalls.get("t1")!.status = "complete";
      rerender();
    });
    // Tick 2 prunes its bookkeeping (row is no longer running).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The row runs again under the same id: a fresh lifetime whose probe must
    // not wait out the previous lifetime's re-arm window.
    act(() => {
      result.current.get("s1")!.toolCalls.get("t1")!.status = "running";
      rerender();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("X4: a key re-inserted by a late 404 is discarded by the next tick", async () => {
    // A reconcile request in flight when its row goes terminal re-inserts the
    // row's 404 count from the response handler. The next tick must discard it
    // again, so the count restarts from zero rather than accumulating across
    // lifetimes.
    vi.setSystemTime(STALE_TOOL_MS + 100);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release404: (() => void) | undefined;
    const inFlight = new Promise<void>((resolve) => {
      release404 = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        await inFlight;
        return { ok: false, status: 404, json: async () => ({}) };
      })
      .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const initial = new Map([["s1", supersededStuckState("t1")]]);
    const { result, rerender } = renderHook(() => useHarness(initial));

    // Tick 1: the stale running row is probed; the response stays in flight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS + 1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The row reaches terminal while the request is still in flight.
    act(() => {
      result.current.get("s1")!.toolCalls.get("t1")!.status = "complete";
      rerender();
    });

    // Tick 2: the row is no longer running, so the tick prunes its bookkeeping.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS);
    });

    // The late 404 lands and re-inserts the since-terminal row's key.
    await act(async () => {
      release404?.();
      await inFlight;
    });

    // Tick 3 discards the re-inserted key again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS);
    });

    // The row runs again under the same id: its 404 count restarts from zero, so
    // a single fresh 404 must NOT exhaust recovery and trigger the supersede heal.
    act(() => {
      result.current.get("s1")!.toolCalls.get("t1")!.status = "running";
      rerender();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS); // probe → 404 (count = 1)
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECONCILE_POLL_MS); // scan
    });

    expect(result.current.get("s1")!.toolCalls.get("t1")!.status).toBe("running");
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * `elided` is invisible to both reconcile selectors — test-plan E28.
 *
 * An unloadable result must never be relabelled as a fault: the supersede heal
 * would stamp it with the SUPERSEDE sentinel ("result unavailable — recovered
 * by supersede heal"), which attributes a deliberate WINDOWING decision to a
 * failure. `elided` is terminal, so the existing `status !== "running"` guard
 * is what excludes it; these tests pin that it stays excluded.
 * See change: fix-lazy-history-backfill-ux (D5).
 */
describe("reconcile selectors reject `elided` (E28)", () => {
  function elidedToolState(toolCallId: string, startedAt: number): SessionState {
    const s = runningToolState(toolCallId, startedAt);
    s.toolCalls.set(toolCallId, { ...s.toolCalls.get(toolCallId)!, status: "elided" });
    const row = s.messages.find((m) => m.toolCallId === toolCallId)!;
    row.toolStatus = "elided";
    return s;
  }

  const states = (s: SessionState) => new Map([["sess-1", s]]);
  // Long past any staleness threshold, and past the supersede 404 floor: the
  // ONLY thing keeping these selectors away is the terminal status.
  const LONG_AGO = 1;
  const NOW = LONG_AGO + STALE_TOOL_MS * 100;

  it("E28: selectStaleRunningTools does not select an elided row", () => {
    // Control: the same row while `running` IS selected, so the test cannot
    // pass for an unrelated reason.
    expect(selectStaleRunningTools(states(runningToolState("t1", LONG_AGO)), NOW, STALE_TOOL_MS, () => false))
      .toHaveLength(1);
    expect(selectStaleRunningTools(states(elidedToolState("t1", LONG_AGO)), NOW, STALE_TOOL_MS, () => false))
      .toEqual([]);
  });

  it("E28: selectSupersededHealTargets does not select an elided row", () => {
    // `hasLaterAssistantInference` reads the inference COUNTER, not the row
    // list: the tool must have been emitted at an earlier inference than the
    // session has since reached.
    const withInference = (s: SessionState) => {
      s.toolCalls.set("t1", { ...s.toolCalls.get("t1")!, emittedAtInferenceSeq: 1 });
      s.assistantInferenceSeq = 2;
      return s;
    };
    const exhausted = () => SUPERSEDE_MIN_404;
    // Control: `running` + exhausted recovery + a later inference IS a target.
    expect(selectSupersededHealTargets(states(withInference(runningToolState("t1", LONG_AGO))), SUPERSEDE_MIN_404, exhausted))
      .toHaveLength(1);
    expect(selectSupersededHealTargets(states(withInference(elidedToolState("t1", LONG_AGO))), SUPERSEDE_MIN_404, exhausted))
      .toEqual([]);
  });
});
