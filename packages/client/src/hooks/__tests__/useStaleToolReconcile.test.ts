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
  RECONCILE_POLL_MS,
  STALE_TOOL_MS,
  SUPERSEDE_MIN_404,
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
});
