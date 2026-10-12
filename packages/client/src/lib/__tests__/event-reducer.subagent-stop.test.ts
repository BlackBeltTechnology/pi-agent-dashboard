/**
 * A stopped subagent's Agent card finalizes even when its tool end is lost (L1).
 * Folded from test-plan.md E1–E19, F1–F6, X1, X4.
 * See change: finalize-agent-card-on-subagent-stop.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialState,
  reduceEvent,
  type SessionState,
  SUBAGENT_DONE_NO_RESULT,
  SUBAGENT_FAILED_NO_ERROR,
  SUBAGENT_STOPPED_SENTINEL_BODY,
} from "../chat/event-reducer.js";

const ev = (eventType: string, data: Record<string, unknown>, timestamp = 1000): DashboardEvent => ({
  eventType,
  timestamp,
  data,
});
const apply = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

const start = (id: string, toolName = "Agent", ts = 1000) =>
  ev("tool_execution_start", { toolCallId: id, toolName, args: {} }, ts);
const tick = (id: string, agentId: string | undefined, text: string, extra: Record<string, unknown> = {}, ts = 2000) =>
  ev(
    "tool_execution_update",
    {
      toolCallId: id,
      toolName: "Agent",
      partialResult: {
        content: [{ type: "text", text }],
        details: { ...(agentId ? { agentId } : {}), status: "running", ...extra },
      },
    },
    ts,
  );
const completed = (agentId: string, result?: string, extra: Record<string, unknown> = {}, ts = 4000) =>
  ev("subagent_completed", { id: agentId, ...(result !== undefined ? { result } : {}), ...extra }, ts);
const failed = (agentId: string, error?: string, extra: Record<string, unknown> = {}, ts = 4000) =>
  ev("subagent_failed", { id: agentId, ...(error !== undefined ? { error } : {}), ...extra }, ts);
const realEnd = (id: string, result: string, extra: Record<string, unknown> = {}, ts = 5000) =>
  ev("tool_execution_end", { toolCallId: id, toolName: "Agent", result, isError: false, ...extra }, ts);
const settled = (ts = 6000) => ev("agent_settled", {}, ts);

const row = (s: SessionState, id: string) => s.messages.find((m) => m.toolCallId === id)!;

/** Three running Agent rows A/B/C linked to ag-A/ag-B/ag-C. */
const threeRunning = () =>
  apply([
    start("A"),
    start("B"),
    start("C"),
    tick("A", "ag-A", "A working"),
    tick("B", "ag-B", "B working"),
    tick("C", "ag-C", "C working"),
  ]);

afterEach(() => vi.useRealTimers());

describe("subagent terminal event finalizes its Agent card", () => {
  it("dropped end + subagent_completed finalizes only that row (E1)", () => {
    const s = apply([completed("ag-A", "done A")], threeRunning());
    const a = row(s, "A");
    expect(a.toolStatus).toBe("complete");
    expect(a.toolDetails?.status).toBe("completed");
    expect(a.result).toBe("done A");
    expect(a.toolDetails?.healedBy).toBe("subagent_stopped");
    expect(s.toolCalls.get("A")?.status).toBe("complete");
    for (const id of ["B", "C"]) {
      expect(row(s, id).toolStatus).toBe("running");
      expect(row(s, id).toolDetails?.status).toBe("running");
      expect(s.toolCalls.get(id)?.status).toBe("running");
    }
  });

  it("subagent_failed finalizes as error with its message (E2)", () => {
    const s = apply([start("X"), tick("X", "ag-X", "X working"), failed("ag-X", "boom")]);
    const x = row(s, "X");
    expect(x.toolStatus).toBe("error");
    expect(x.toolDetails?.status).toBe("error");
    expect(x.toolDetails?.error).toBe("boom");
    expect(x.result).not.toBe("X working");
  });

  it.each([undefined, ""])("empty completion result → fallback body, never the stale tick (E3: %s)", (result) => {
    const s = apply([start("X"), tick("X", "ag-X", "X working"), completed("ag-X", result)]);
    expect(row(s, "X").result).toBe(SUBAGENT_DONE_NO_RESULT);
    expect(SUBAGENT_DONE_NO_RESULT).toBe("subagent finished");
  });

  it("empty failure error → 'subagent failed' (E4)", () => {
    const s = apply([start("X"), tick("X", "ag-X", "X working"), failed("ag-X")]);
    expect(row(s, "X").toolStatus).toBe("error");
    expect(row(s, "X").result).toBe(SUBAGENT_FAILED_NO_ERROR);
    expect(SUBAGENT_FAILED_NO_ERROR).toBe("subagent failed");
  });

  it("agent id learned after the subagent finished (E5)", () => {
    const s = apply([start("X"), tick("X", undefined, "warming"), completed("ag-X", "r"), tick("X", "ag-X", "late")]);
    const x = row(s, "X");
    expect(x.toolStatus).toBe("complete");
    expect(x.result).toBe("r");
    expect(x.toolDetails?.healedBy).toBe("subagent_stopped");
  });

  it("propagates the trigger's own heal marker (E6)", () => {
    const s = apply([
      start("X"),
      tick("X", "ag-X", "X working"),
      failed("ag-X", "parent session ended", { healedBy: "session_ended" }),
    ]);
    expect(row(s, "X").toolStatus).toBe("error");
    expect(row(s, "X").toolDetails?.healedBy).toBe("session_ended");
  });

  it("a heal-marked terminal event on an already-terminal subagent is ignored (E7)", () => {
    // Subagent recorded completed while the row had no agent id yet.
    let s = apply([start("X"), tick("X", undefined, "warming"), completed("ag-X", "ok")]);
    // Link the row to ag-X without passing through the update arm.
    s = linkRow(s, "X", "ag-X");
    s = apply([failed("ag-X", "parent session ended", { healedBy: "session_ended" })], s);
    expect(row(s, "X").toolStatus).toBe("running");
    expect(s.subagents.get("ag-X")?.status).toBe("completed");
  });

  it("terminal row is never touched (E8)", () => {
    const s = apply([
      start("X"),
      tick("X", "ag-X", "X working"),
      ev("tool_execution_end", { toolCallId: "X", toolName: "Agent", result: "real err", isError: true }, 3000),
      completed("ag-X", "ok"),
    ]);
    const x = row(s, "X");
    expect(x.toolStatus).toBe("error");
    expect(x.result).toBe("real err");
    expect(x.toolDetails?.healedBy).toBeUndefined();
  });

  it("no matching row is a no-op on messages and toolCalls (E9)", () => {
    const before = threeRunning();
    const s = apply([completed("ag-Z", "z")], before);
    expect(s.messages).toEqual(before.messages);
    expect([...s.toolCalls.entries()]).toEqual([...before.toolCalls.entries()]);
    expect(s.subagents.get("ag-Z")?.status).toBe("completed");
  });

  it("elided rows are untouched by subagent stop and by settle (E10)", () => {
    let s = apply([start("X"), tick("X", "ag-X", "X working")]);
    s = {
      ...s,
      messages: s.messages.map((m) => (m.toolCallId === "X" ? { ...m, toolStatus: "elided" as never } : m)),
      toolCalls: new Map([...s.toolCalls].filter(([k]) => k !== "X")),
    };
    s = apply([completed("ag-X", "ok"), settled()], s);
    expect(row(s, "X").toolStatus).toBe("elided");
  });

  it("synthetic end duration comes from the trigger timestamp (E19)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_999_999_999);
    const s = apply([start("X", "Agent", 1000), tick("X", "ag-X", "w"), completed("ag-X", "r", {}, 4000)]);
    expect(row(s, "X").duration).toBe(3000);
  });

  it("ignores a malformed terminal event without an id (X4)", () => {
    const before = threeRunning();
    let s = before;
    expect(() => {
      s = apply([ev("subagent_completed", { result: "x" }), ev("subagent_completed", { id: 42, result: "x" })], before);
    }).not.toThrow();
    expect(s.messages).toEqual(before.messages);
  });
});

describe("parent settle finalizes any Agent card still running", () => {
  it("neutral settle: sentinel, resultMissing, map stays running, no subagent backfill (E11)", () => {
    const s = apply([start("Y"), tick("Y", "ag-Y", "Y working"), ev("agent_end", {}, 5500), settled()]);
    const y = row(s, "Y");
    expect(y.toolStatus).toBe("complete");
    expect(y.toolDetails?.status).toBe("completed");
    expect(y.result).toBe(SUBAGENT_STOPPED_SENTINEL_BODY);
    expect(SUBAGENT_STOPPED_SENTINEL_BODY).toBe("subagent stopped — result not received");
    expect(y.toolDetails?.healedBy).toBe("turn_settled");
    expect(y.toolDetails?.resultMissing).toBe(true);
    expect(s.toolCalls.get("Y")?.status).toBe("running");
    expect(s.subagents.get("ag-Y")?.status).not.toBe("completed");
  });

  it("settle with a known completed subagent uses its result (E12)", () => {
    let s = apply([start("Y"), tick("Y", undefined, "warming"), completed("ag-Y", "done B")]);
    s = linkRow(s, "Y", "ag-Y");
    s = apply([settled()], s);
    const y = row(s, "Y");
    expect(y.toolStatus).toBe("complete");
    expect(y.result).toBe("done B");
    expect(y.toolDetails?.healedBy).toBe("turn_settled");
    expect(y.toolDetails?.resultMissing).toBeUndefined();
  });

  it("settle with a known failed subagent finalizes as error (E13)", () => {
    let s = apply([start("Y"), tick("Y", undefined, "warming"), failed("ag-Y", "x")]);
    s = linkRow(s, "Y", "ag-Y");
    s = apply([settled()], s);
    expect(row(s, "Y").toolStatus).toBe("error");
    expect(row(s, "Y").toolDetails?.error).toBe("x");
  });

  it("agent_end alone does not finalize (E14)", () => {
    const s = apply([start("Y"), tick("Y", "ag-Y", "w"), ev("agent_end", {}, 5500)]);
    expect(row(s, "Y").toolStatus).toBe("running");
  });

  it("settle leaves non-Agent rows untouched (E15)", () => {
    const s = apply([start("bash1", "bash"), start("Y"), tick("Y", "ag-Y", "w"), settled()]);
    expect(row(s, "bash1").toolStatus).toBe("running");
    expect(row(s, "Y").toolStatus).toBe("complete");
  });

  it("each sibling finalizes from its own subagent only (E16)", () => {
    let s = apply([start("A"), start("B"), start("C"), tick("C", "ag-C", "C working")]);
    s = apply([completed("ag-A", "a"), failed("ag-B", "b")], s);
    s = linkRow(linkRow(s, "A", "ag-A"), "B", "ag-B");
    s = apply([settled()], s);
    expect(row(s, "A").toolStatus).toBe("complete");
    expect(row(s, "A").result).toBe("a");
    expect(row(s, "B").toolStatus).toBe("error");
    expect(row(s, "B").toolDetails?.error).toBe("b");
    expect(row(s, "C").result).toBe(SUBAGENT_STOPPED_SENTINEL_BODY);
    expect(row(s, "C").toolDetails?.resultMissing).toBe(true);
  });

  it("all stop frames shed: settle is the backstop (X1)", () => {
    const s = apply([settled()], threeRunning());
    for (const id of ["A", "B", "C"]) {
      expect(row(s, id).toolStatus).toBe("complete");
      expect(row(s, id).toolDetails?.resultMissing).toBe(true);
    }
  });
});

describe("real end overwrites a heal", () => {
  it("replaces a subagent-stop heal (E17)", () => {
    const s = apply([completed("ag-A", "done A"), realEnd("A", "real A")], threeRunning());
    const a = row(s, "A");
    expect(a.result).toBe("real A");
    expect(a.toolDetails?.healedBy).toBeUndefined();
    expect(a.toolDetails?.resultMissing).toBeUndefined();
  });

  it("a real error end without details keeps the subagent's error text (E17b)", () => {
    const s = apply(
      [failed("ag-A", "boom"), ev("tool_execution_end", { toolCallId: "A", toolName: "Agent", result: "boom", isError: true }, 5000)],
      threeRunning(),
    );
    const a = row(s, "A");
    expect(a.toolStatus).toBe("error");
    expect(a.toolDetails?.error).toBe("boom");
    expect(a.toolDetails?.healedBy).toBeUndefined();
  });

  it("clears heal-only fields after a neutral settle (E18)", () => {
    const s = apply([settled(), realEnd("A", "real A")], threeRunning());
    const a = row(s, "A");
    expect(a.toolStatus).toBe("complete");
    expect(a.result).toBe("real A");
    expect(a.toolDetails?.healedBy).toBeUndefined();
    expect(a.toolDetails?.resultMissing).toBeUndefined();
    expect(s.toolCalls.get("A")?.status).toBe("complete");
  });
});

describe("a finished subagent's card is not reopened by a late tick", () => {
  it("normal ordering with a trailing tick never shows running (F1)", () => {
    let s = apply([start("X"), tick("X", "ag-X", "w")]);
    s = apply([completed("ag-X", "r")], s);
    expect(row(s, "X").toolDetails?.status).not.toBe("running");
    s = apply([tick("X", "ag-X", "late")], s);
    expect(row(s, "X").toolDetails?.status).not.toBe("running");
    expect(row(s, "X").toolStatus).not.toBe("running");
    s = apply([realEnd("X", "real")], s);
    expect(row(s, "X").result).toBe("real");
    expect(row(s, "X").toolDetails?.healedBy).toBeUndefined();
  });

  it("tick after a real end of a finished subagent keeps the terminal fields, merges stats (F2)", () => {
    const s = apply([
      start("X"),
      tick("X", "ag-X", "w"),
      completed("ag-X", "r"),
      realEnd("X", "real"),
      tick("X", "ag-X", "late", { toolUses: 9 }),
    ]);
    const x = row(s, "X");
    expect(x.toolDetails?.status).toBe("completed");
    expect(x.result).toBe("real");
    expect(x.toolDetails?.toolUses).toBe(9);
  });

  it("settle heal is sticky against a late tick (F3)", () => {
    const s = apply([start("Y"), tick("Y", "ag-Y", "w"), settled(), tick("Y", "ag-Y", "late")]);
    const y = row(s, "Y");
    expect(y.toolDetails?.status).toBe("completed");
    expect(y.result).toBe(SUBAGENT_STOPPED_SENTINEL_BODY);
    expect(y.toolDetails?.resultMissing).toBe(true);
  });

  it("orphan-closed but still running reopens on a live tick (F4, pre-existing)", () => {
    const s = apply([
      start("X"),
      tick("X", "ag-X", "w"),
      ev("tool_execution_end", { toolCallId: "X", toolName: "Agent", result: "", isError: true, healedBy: "session_ended", details: { agentId: "ag-X" } }, 3000),
      tick("X", "ag-X", "alive"),
    ]);
    expect(row(s, "X").toolDetails?.status).toBe("running");
  });
});

describe("determinism", () => {
  const streams: DashboardEvent[][] = [
    [start("A"), tick("A", "ag-A", "w"), completed("ag-A", "r")],
    [start("A"), tick("A", "ag-A", "w"), settled()],
    [start("A"), tick("A", "ag-A", "w"), completed("ag-A", "r"), tick("A", "ag-A", "late"), realEnd("A", "real")],
  ];
  it.each(streams.map((s, i) => [i, s] as const))("same stream → same state (F5 #%s)", (_i, stream) => {
    expect(apply(stream)).toEqual(apply(stream));
  });

  it("server update-collapse does not change the outcome (F6)", () => {
    const full = [start("A"), tick("A", "ag-A", "p"), completed("ag-A", "r"), tick("A", "ag-A", "s"), ev("tool_execution_end", { toolCallId: "A", result: "real", isError: false }, 5000)];
    const collapsed = full.filter((_, i) => i !== 1);
    const pick = (s: SessionState) => {
      const a = row(s, "A");
      return { toolStatus: a.toolStatus, status: a.toolDetails?.status, healedBy: a.toolDetails?.healedBy, result: a.result };
    };
    expect(pick(apply(collapsed))).toEqual(pick(apply(full)));
  });
});

/** Attach `agentId` to a row's toolDetails without passing through the update arm. */
function linkRow(s: SessionState, toolCallId: string, agentId: string): SessionState {
  return {
    ...s,
    messages: s.messages.map((m) =>
      m.toolCallId === toolCallId ? { ...m, toolDetails: { ...(m.toolDetails ?? {}), agentId, status: "running" } } : m,
    ),
  };
}
