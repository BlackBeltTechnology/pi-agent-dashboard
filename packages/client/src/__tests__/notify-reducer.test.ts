/**
 * A notify is a render-only chat row: both reducers must append an
 * `interactiveUi` row to `messages` and NEVER an `interactiveRequests` entry
 * (that list is where the "user is blocked" semantics live).
 *
 * Covers test-plan #F1 (main-app reducer), #F2 (embed reducer), #E9 (dedup by
 * notifyId, not message text).
 *
 * See change: split-notify-from-prompt-request.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type MessageHandlerDeps, type MessageHandlerSetters, useMessageHandler } from "../hooks/useMessageHandler.js";
import { applySessionMessage, useSessionState } from "../hooks/useSessionState.js";
import { addNotify, type ChatMessage, createInitialState, reseatTimedNotifies, type SessionState } from "../lib/chat/event-reducer.js";

const SID = "session-abc";

function makeMainAppHarness(initial: SessionState = createInitialState()) {
  let sessionStates = new Map<string, SessionState>([[SID, initial]]);
  const setSessionStates = ((updater: any) => {
    sessionStates = typeof updater === "function" ? updater(sessionStates) : updater;
  }) as React.Dispatch<React.SetStateAction<Map<string, SessionState>>>;

  const noop = ((_: any) => {}) as any;
  const setters = new Proxy({ setSessionStates } as Partial<MessageHandlerSetters>, {
    get: (target, prop) => (prop in target ? (target as any)[prop] : noop),
  }) as MessageHandlerSetters;

  const deps: MessageHandlerDeps = {
    send: () => {},
    navigate: () => {},
    clearSpawningCwd: () => {},
    spawningCwdsRef: { current: new Set<string>() },
    subscribedRef: { current: new Set<string>() },
    pendingTerminalCwdRef: { current: null },
    lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map<string, number>() },
    selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() },
    loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() },
  } as MessageHandlerDeps;

  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (msg: any) => act(() => result.current(msg)),
    get state() {
      return sessionStates.get(SID)!;
    },
  };
}

function notifyMsg(notifyId: string, message = "hello", level?: string) {
  return { type: "notify", sessionId: SID, notifyId, message, ...(level ? { level } : {}) } as any;
}

describe("notify reducer — chat row only, no pending request", () => {
  it("#F1 main-app reducer adds one interactiveUi row and no interactive request", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1", "hello", "success"));

    expect(h.state.interactiveRequests).toHaveLength(0);
    const rows = h.state.messages.filter((m) => m.role === "interactiveUi");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("ui-n1");
    expect(rows[0].content).toBe("notify");
    expect((rows[0].args as any).params).toEqual({ message: "hello", level: "success" });
  });

  it("#F2 embed session-state reducer holds the same invariant", () => {
    const { result } = renderHook(() => useSessionState(SID));

    act(() => result.current.apply(notifyMsg("n1")));

    expect(result.current.state.interactiveRequests).toHaveLength(0);
    expect(result.current.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(1);
  });

  it("#E9 dedups by notifyId, not by message text", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1", "same text"));
    h.dispatch(notifyMsg("n2", "same text"));

    expect(h.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(2);
    expect(h.state.interactiveRequests).toHaveLength(0);
  });

  it("a replayed notify with a known notifyId does not duplicate the row", () => {
    const h = makeMainAppHarness();

    h.dispatch(notifyMsg("n1"));
    h.dispatch(notifyMsg("n1"));

    expect(h.state.messages.filter((m) => m.role === "interactiveUi")).toHaveLength(1);
  });
});

// ── collapse-and-order-notify-rows: chronological placement ─────────
//
// A `ts`-bearing notify is placed by `insertByTs`; without `ts` it keeps the
// old tail append. See test-plan #E5–#E9, #X1, #X2.

/** A plain transcript row stamped `ts`, or a history-gap divider. */
function row(ts: number, id = `r${ts}`): ChatMessage {
  return { id, role: "user", content: `row ${ts}`, timestamp: ts };
}
function gap(ts = 9999): ChatMessage {
  return { id: `gap-${ts}`, role: "historyGap", content: "", timestamp: ts };
}
function stateOf(messages: ChatMessage[]): SessionState {
  return { ...createInitialState(), messages };
}
/** Ids in order, notify rows rendered as `N<ts>` for readability. */
function order(state: SessionState): string[] {
  return state.messages.map((m) => (m.role === "interactiveUi" ? `N${m.timestamp}` : m.id));
}

describe("notify placement by ts", () => {
  it("#E5 places by ts at every boundary and stamps the row with ts", () => {
    const base = [row(100), row(200), row(300)];
    const cases: Array<[number, string[]]> = [
      [50, ["N50", "r100", "r200", "r300"]],
      [100, ["r100", "N100", "r200", "r300"]],
      [250, ["r100", "r200", "N250", "r300"]],
      [300, ["r100", "r200", "r300", "N300"]],
      [400, ["r100", "r200", "r300", "N400"]],
    ];
    for (const [ts, expected] of cases) {
      const next = addNotify(stateOf(base), `n${ts}`, "m", "info", ts);
      expect(order(next), `ts=${ts}`).toEqual(expected);
      const notifyRow = next.messages.find((m) => m.id === `ui-n${ts}`)!;
      expect(notifyRow.timestamp).toBe(ts);
      expect((notifyRow.args as any).params.ts).toBe(ts);
    }
  });

  it("#E6 history-gap dividers are never anchors", () => {
    // (a) leading divider, notify older than the loaded window
    expect(order(addNotify(stateOf([gap(), row(500), row(600)]), "a", "m", undefined, 100))).toEqual([
      "gap-9999", "N100", "r500", "r600",
    ]);
    // (b) mid-list divider stamped far in the future is skipped
    expect(
      order(addNotify(stateOf([row(100), row(200), gap(), row(800), row(900)]), "b", "m", undefined, 300)),
    ).toEqual(["r100", "r200", "N300", "gap-9999", "r800", "r900"]);
    // (c) only a divider → append after it
    expect(order(addNotify(stateOf([gap()]), "c", "m", undefined, 5))).toEqual(["gap-9999", "N5"]);
    // (d) empty transcript → single row
    expect(order(addNotify(stateOf([]), "d", "m", undefined, 5))).toEqual(["N5"]);
  });

  it("#E7 without ts the row is appended with the client clock", () => {
    vi.spyOn(Date, "now").mockReturnValue(9000);
    try {
      const next = addNotify(stateOf([row(100), row(200)]), "n1", "m");
      expect(order(next)).toEqual(["r100", "r200", "N9000"]);
      expect("ts" in (next.messages[2].args as any).params).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("#E8 a replayed notifyId returns the same state reference", () => {
    const first = addNotify(stateOf([row(100), row(300)]), "n1", "m", undefined, 200);
    expect(first.messages[1].id).toBe("ui-n1");
    const replayed = addNotify(first, "n1", "m", undefined, 200);
    expect(replayed).toBe(first);
    expect(replayed.messages.filter((m) => m.id === "ui-n1")).toHaveLength(1);
  });

  it("#E9 both reducers place a timed notify identically", () => {
    const seeded = [row(100), row(200), row(300)];
    const h = makeMainAppHarness(stateOf(seeded));
    h.dispatch({ ...notifyMsg("n1", "m", "warning"), ts: 250 });

    const embed = applySessionMessage(
      { state: stateOf(seeded), maxSeq: 0 },
      { ...notifyMsg("n1", "m", "warning"), ts: 250 },
    );

    expect(order(h.state)).toEqual(["r100", "r200", "N250", "r300"]);
    expect(order(embed.state)).toEqual(order(h.state));
    expect(h.state.interactiveRequests).toHaveLength(0);
    expect(embed.state.interactiveRequests).toHaveLength(0);
  });

  it("non-finite ts (NaN / ±Infinity) is treated as absent: tail append, never re-seated", () => {
    vi.spyOn(Date, "now").mockReturnValue(9000);
    try {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const next = addNotify(stateOf([row(100), row(200)]), "n", "m", undefined, bad);
        expect(order(next), String(bad)).toEqual(["r100", "r200", "N9000"]);
        expect("ts" in (next.messages[2].args as any).params, String(bad)).toBe(false);
      }
      // A stored row carrying a non-finite params.ts is left where it is.
      const stray = { ...row(50, "stray"), role: "interactiveUi", content: "notify", args: { method: "notify", params: { message: "m", ts: Number.NaN } } } as ChatMessage;
      const list = [row(100), stray, row(200)];
      expect(reseatTimedNotifies(list)).toBe(list);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("#X1 old-server frames (no ts) append in arrival order without throwing", () => {
    const h = makeMainAppHarness(stateOf([row(100), row(200)]));
    h.dispatch(notifyMsg("a", "first"));
    h.dispatch(notifyMsg("b", "second"));
    const ids = h.state.messages.map((m) => m.id);
    expect(ids).toEqual(["r100", "r200", "ui-a", "ui-b"]);
    for (const m of h.state.messages.slice(2)) expect(m.timestamp).toBeGreaterThan(1_000_000_000_000);
  });

  it("#X2 mixed-provenance replay: ts-less row at the tail, ts row placed", () => {
    vi.spyOn(Date, "now").mockReturnValue(9000);
    try {
      let s = stateOf([row(100), row(200), row(300)]);
      s = addNotify(s, "legacy", "m");
      s = addNotify(s, "timed", "m", undefined, 250);
      // The documented one-time inversion: the ts row lands above the
      // ts-less one even though it arrived later.
      expect(order(s)).toEqual(["r100", "r200", "N250", "r300", "N9000"]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
