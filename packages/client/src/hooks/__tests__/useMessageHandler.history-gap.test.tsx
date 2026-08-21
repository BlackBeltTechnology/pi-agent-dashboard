/**
 * Client-side windowed-replay behaviour — test-plan rows F4, F6, F8, F9, F10
 * and F11, plus the D10 "touches messages[] and nothing else" contract.
 *
 * These were catalogued as L3. They are covered here at jsdom level instead:
 * `history_window` / `history_backfill_result` arrive over the WEBSOCKET, which
 * Playwright's `page.route()` cannot intercept, and firing the real server path
 * would require the shared docker harness to boot with a non-zero
 * `maxReplayEvents` — a restart-only field on a container every other spec
 * shares. Driving the real handler with the real protocol messages exercises
 * the same production code with none of that shared-state coupling.
 *
 * See change: lazy-load-session-history (D10, D11, D12).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { HISTORY_GAP_ROW_ID, type HistoryGapState } from "../../lib/chat/history-gap.js";
import { createReplayCache } from "../../lib/replay/replay-cache.js";
import { createReplayPersister } from "../../lib/replay/replay-persist.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

const SID = "s1";

function evt(eventType: string, text: string): DashboardEvent {
  return {
    eventType,
    timestamp: 1,
    data: { message: { role: "user", content: [{ type: "text", text }] } },
  } as unknown as DashboardEvent;
}

interface Harness {
  handle: (m: ServerToBrowserMessage) => void;
  states: Map<string, SessionState>;
  gaps: Map<string, HistoryGapState>;
  publishEvents: ReturnType<typeof vi.fn>;
  maxSeqs: Map<string, number>;
  persisterSeed: ReturnType<typeof vi.fn>;
  persisterRecord: ReturnType<typeof vi.fn>;
  spliceRev: number;
}

/**
 * Drives the REAL hook with real setters, so `messages[]`, the gap map, the
 * seq high-water mark and the persister are all observed exactly as App wires
 * them — not through a Proxy that swallows the writes we need to assert about.
 */
function mount(): { get: () => Harness; fire: (m: ServerToBrowserMessage) => void } {
  const cache = createReplayCache({ factory: new IDBFactory() });
  const real = createReplayPersister(cache, 0, () => "a:8000");
  const persisterSeed = vi.fn(real.seed);
  const persisterRecord = vi.fn(real.record);
  const publishEvents = vi.fn();

  vi.doMock("@blackbelt-technology/dashboard-plugin-runtime", async (orig) => {
    const mod = (await orig()) as Record<string, unknown>;
    return { ...mod, publishSessionEvents: publishEvents };
  });

  let latest!: Harness;
  renderHook(() => {
    const [states, setSessionStates] = useState(new Map<string, SessionState>([[SID, createInitialState()]]));
    const [gaps, setHistoryGaps] = useState(new Map<string, HistoryGapState>());
    const [spliceRev, setHistorySpliceRev] = useState(0);
    const maxSeqMapRef = useRef(new Map<string, number>());
    const setters = new Proxy(
      { setSessionStates, setHistoryGaps, setHistorySpliceRev },
      {
        get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : vi.fn()),
      },
    ) as unknown as MessageHandlerSetters;
    const deps: any = {
      send: vi.fn(),
      navigate: vi.fn(),
      clearSpawningCwd: vi.fn(),
      spawningCwdsRef: useRef(new Set<string>()),
      subscribedRef: useRef(new Set<string>()),
      pendingTerminalCwdRef: useRef(null),
      lastCreatedTerminalIdRef: useRef(null),
      maxSeqMapRef,
      selectedSessionIdRef: useRef(SID),
      pendingSpawnsRef: useRef(new Map()),
      loadingHistoryTimersRef: useRef(new Map()),
      replayInFlightTimersRef: useRef(new Map()),
      replayPersister: { ...real, seed: persisterSeed, record: persisterRecord },
    };
    const handle = useMessageHandler(setters, deps);
    latest = { handle, states, gaps, publishEvents, maxSeqs: maxSeqMapRef.current, persisterSeed, persisterRecord, spliceRev };
    return null;
  });
  // Every `handle` call drives React state updates, so it must run inside
  // `act` or the assertions below read the PREVIOUS render's snapshot.
  return { get: () => latest, fire: (m: ServerToBrowserMessage) => act(() => latest.handle(m)) };
}

const windowMsg = (over: Partial<Extract<ServerToBrowserMessage, { type: "history_window" }>> = {}) =>
  ({
    type: "history_window",
    sessionId: SID,
    headMaxSeq: 20,
    tailMinSeq: 4800,
    gapCount: 1200,
    oldestGapSeq: 21,
    ...over,
  }) as ServerToBrowserMessage;

/** A windowed replay: head seqs 1–20, then tail seqs 4800+. */
function windowedReplay(tailCount = 3): ServerToBrowserMessage {
  const events = [
    ...Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, event: evt("message_start", `head ${i}`) })),
    ...Array.from({ length: tailCount }, (_, i) => ({ seq: 4800 + i, event: evt("message_start", `tail ${i}`) })),
  ];
  return { type: "event_replay", sessionId: SID, events, isLast: true } as ServerToBrowserMessage;
}

const rowIds = (h: Harness) => (h.states.get(SID)?.messages ?? []).map((m) => m.id);
const gapIndex = (h: Harness) => rowIds(h).indexOf(HISTORY_GAP_ROW_ID);

describe("history_window — disclosure and divider placement (F5)", () => {
  it("records the gap and places the divider BETWEEN the head and tail rows", () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());

    const gap = h.get().gaps.get(SID)!;
    expect(gap.gapCount).toBe(1200);
    expect(gap.headMaxSeq).toBe(20);
    expect(gap.tailMinSeq).toBe(4800);

    const at = gapIndex(h.get());
    expect(at).toBeGreaterThan(0);
    const msgs = h.get().states.get(SID)!.messages;
    // Everything above the divider is head content, everything below is tail.
    expect(msgs.slice(0, at).every((m) => m.content.startsWith("head "))).toBe(true);
    expect(msgs.slice(at + 1).every((m) => m.content.startsWith("tail "))).toBe(true);
  });

  it("a gapCount of 0 discloses nothing and places no divider", () => {
    const h = mount();
    h.fire(windowMsg({ gapCount: 0 }));
    h.fire(windowedReplay());
    expect(h.get().gaps.get(SID)).toBeUndefined();
    expect(gapIndex(h.get())).toBe(-1);
  });
});

describe("history_backfill_result — the splice (F6, F8, D10)", () => {
  const primed = () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());
    return h;
  };

  it("F6/F8: spliced rows land INSIDE the gap; head and tail rows keep their identity", () => {
    const h = primed();
    const before = h.get().states.get(SID)!.messages;
    const headIds = before.slice(0, gapIndex(h.get())).map((m) => m.id);
    const tailIds = before.slice(gapIndex(h.get()) + 1).map((m) => m.id);

    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [
        { seq: 21, event: evt("message_start", "mid A") },
        { seq: 22, event: evt("message_start", "mid B") },
      ],
      servedFrom: 21,
      servedTo: 22,
      remainingGapCount: 1198,
    } as ServerToBrowserMessage);

    const after = h.get().states.get(SID)!.messages;
    const at = gapIndex(h.get());
    expect(at).toBeGreaterThan(0);
    // The spliced rows sit immediately ABOVE the divider — the gap fills from
    // the head side, which is what makes remainingGapCount shrink.
    expect(after.slice(at - 2, at).map((m) => m.content)).toEqual(["mid A", "mid B"]);
    // Identity preserved on both sides: the transcript was NOT rebuilt.
    expect(after.slice(0, headIds.length).map((m) => m.id)).toEqual(headIds);
    expect(after.slice(at + 1).map((m) => m.id)).toEqual(tailIds);
  });

  it("D10: the splice does not move the live seq high-water mark", () => {
    const h = primed();
    const before = h.get().maxSeqs.get(SID);
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [{ seq: 21, event: evt("message_start", "mid") }],
      servedFrom: 21,
      servedTo: 21,
      remainingGapCount: 1199,
    } as ServerToBrowserMessage);
    // Backfilled seqs are BELOW the current max by construction; advancing the
    // mark would make `clearReplaying` skip real live events.
    expect(h.get().maxSeqs.get(SID)).toBe(before);
  });

  it("D10: the splice does not write to the durable replay cache", () => {
    const h = primed();
    h.get().persisterSeed.mockClear();
    h.get().persisterRecord.mockClear();
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [{ seq: 21, event: evt("message_start", "mid") }],
      servedFrom: 21,
      servedTo: 21,
      remainingGapCount: 1199,
    } as ServerToBrowserMessage);
    expect(h.get().persisterSeed).not.toHaveBeenCalled();
    expect(h.get().persisterRecord).not.toHaveBeenCalled();
  });
});

describe("the splice revision drives the scroll anchor, not messages.length", () => {
  const primed = () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());
    return h;
  };

  it("bumps on a splice \u2014 INCLUDING the final one, where the net row count is unchanged", () => {
    const h = primed();
    const before = h.get().spliceRev;
    // One row spliced in AND the divider removed: net length change is zero,
    // so a length-keyed restore would never fire. The revision still bumps.
    const lengthBefore = h.get().states.get(SID)!.messages.length;
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [{ seq: 21, event: evt("message_start", "last") }],
      servedFrom: 21,
      servedTo: 4799,
      remainingGapCount: 0,
    } as ServerToBrowserMessage);
    expect(h.get().states.get(SID)!.messages.length).toBe(lengthBefore);
    expect(h.get().spliceRev).toBe(before + 1);
  });

  it("does NOT bump on a live event, which also changes messages.length", () => {
    const h = primed();
    const before = h.get().spliceRev;
    h.fire({
      type: "event",
      sessionId: SID,
      seq: 5000,
      event: evt("message_start", "live"),
    } as ServerToBrowserMessage);
    expect(h.get().spliceRev).toBe(before);
  });

  it("does NOT bump on a refusal or an empty response", () => {
    const h = primed();
    const before = h.get().spliceRev;
    for (const msg of [
      { events: [], servedFrom: 0, servedTo: 0, remainingGapCount: 0, error: "in_flight" as const },
      { events: [], servedFrom: 21, servedTo: 520, remainingGapCount: 700 },
    ]) {
      h.fire({ type: "history_backfill_result", sessionId: SID, ...msg } as ServerToBrowserMessage);
    }
    expect(h.get().spliceRev).toBe(before);
  });
});

describe("history_backfill_result — loop termination (F9)", () => {
  const primed = () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());
    return h;
  };

  it("F9: a fully-filled gap removes the divider AND the gap state entirely", () => {
    const h = primed();
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [{ seq: 21, event: evt("message_start", "last") }],
      servedFrom: 21,
      servedTo: 4799,
      remainingGapCount: 0,
    } as ServerToBrowserMessage);
    expect(gapIndex(h.get())).toBe(-1);
    expect(h.get().gaps.get(SID)).toBeUndefined();
  });

  it("a response with ZERO events over a trimmed hole marks the gap unservable, not failed", () => {
    // The stop rule is keyed on the RESPONSE, not on arithmetic, so it
    // terminates over a holey store without a distinct "hole" error code.
    const h = primed();
    h.fire({
      type: "history_backfill_result",
      sessionId: SID,
      events: [],
      servedFrom: 21,
      servedTo: 520,
      remainingGapCount: 700,
    } as ServerToBrowserMessage);
    const gap = h.get().gaps.get(SID)!;
    expect(gap.unservable).toBe(true);
    expect(gap.failed).toBe(false);
  });

  it("every refusal code collapses to the SAME retryable failed state, never a code", () => {
    for (const error of ["not_subscribed", "in_flight", "out_of_range", "stale_generation"] as const) {
      const h = primed();
      h.fire({
        type: "history_backfill_result",
        sessionId: SID,
        events: [],
        servedFrom: 0,
        servedTo: 0,
        remainingGapCount: 0,
        error,
      } as ServerToBrowserMessage);
      const gap = h.get().gaps.get(SID)!;
      expect(gap.failed, error).toBe(true);
      expect(gap.pending, error).toBe(false);
      // The count is PRESERVED across a refusal — the gap did not shrink.
      expect(gap.gapCount, error).toBe(1200);
    }
  });
});

describe("arming and invalidation (F4, F10)", () => {
  it("F10: the affordance is DISARMED until the terminal replay batch lands", () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire({
      type: "event_replay",
      sessionId: SID,
      events: [{ seq: 1, event: evt("message_start", "head 0") }],
      isLast: false,
    } as ServerToBrowserMessage);
    expect(h.get().gaps.get(SID)!.armed).toBe(false);

    h.fire({ type: "event_replay", sessionId: SID, events: [], isLast: true } as ServerToBrowserMessage);
    expect(h.get().gaps.get(SID)!.armed).toBe(true);
  });

  it("F4: session_state_reset drops the gap, so a stale exploration cannot survive it", () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());
    expect(h.get().gaps.get(SID)).toBeDefined();

    h.fire({ type: "session_state_reset", sessionId: SID } as ServerToBrowserMessage);
    expect(h.get().gaps.get(SID)).toBeUndefined();
    expect(gapIndex(h.get())).toBe(-1);
  });
});

describe("F11: a windowed replay is never written to the replay cache (D12)", () => {
  it("suppresses the persister write for a session whose replay carried a gap", () => {
    const h = mount();
    h.fire(windowMsg());
    h.fire(windowedReplay());
    // Caching a SPARSE array as contiguous would make the next reload a cache
    // HIT that delta-subscribes — and a delta never emits `history_window`, so
    // the gap would become permanently invisible and unrecoverable.
    expect(h.get().persisterSeed).not.toHaveBeenCalled();
    expect(h.get().persisterRecord).not.toHaveBeenCalled();
  });

  it("an UNWINDOWED replay still seeds the cache exactly as before", () => {
    const h = mount();
    h.fire({
      type: "event_replay",
      sessionId: SID,
      events: [{ seq: 1, event: evt("message_start", "only") }],
      isLast: true,
    } as ServerToBrowserMessage);
    expect(h.get().persisterSeed).toHaveBeenCalledTimes(1);
  });
});
