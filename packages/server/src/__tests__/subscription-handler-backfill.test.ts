/**
 * Handler-level windowing + `history_backfill` — test-plan scenarios
 * E14/E15/E16, E27-E31, P3, and X1-X4/X6.
 *
 * See change: lazy-load-session-history (D1, D6, D9).
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import {
  BACKFILL_MAX_SPAN,
  handleHistoryBackfill,
  handleSubscribe,
  peekGapState,
} from "../browser-handlers/subscription-handler.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

function makeEvent(eventType = "tool_execution_end"): DashboardEvent {
  return { eventType, timestamp: 1, data: {} };
}

const openWs = () => ({ readyState: 1, OPEN: 1, bufferedAmount: 0 }) as any;

function createMockContext(overrides: Partial<BrowserHandlerContext> = {}): BrowserHandlerContext {
  return {
    ws: openWs(),
    sessionManager: createMemorySessionManager(),
    eventStore: createMemoryEventStore(() => false),
    piGateway: { sendToSession: vi.fn() } as any,
    headlessPidRegistry: {} as any,
    pendingResumeRegistry: {} as any,
    sendTo: vi.fn(),
    broadcast: vi.fn(),
    getSubscribers: () => [],
    trackUiRequest: vi.fn(),
    replayPendingUiRequests: vi.fn(),
    replayNotifyLog: vi.fn(),
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
    ...overrides,
  };
}

const sentOf = (ctx: BrowserHandlerContext) =>
  ((ctx.sendTo as any).mock.calls as Array<[unknown, ServerToBrowserMessage]>).map(([, m]) => m);

const replayedEvents = (ctx: BrowserHandlerContext) =>
  sentOf(ctx)
    .filter((m): m is Extract<ServerToBrowserMessage, { type: "event_replay" }> => m.type === "event_replay")
    .flatMap((m) => m.events);

const windowsOf = (ctx: BrowserHandlerContext) =>
  sentOf(ctx).filter((m): m is Extract<ServerToBrowserMessage, { type: "history_window" }> => m.type === "history_window");

const resultsOf = (ctx: BrowserHandlerContext) =>
  sentOf(ctx).filter(
    (m): m is Extract<ServerToBrowserMessage, { type: "history_backfill_result" }> => m.type === "history_backfill_result",
  );

function seed(ctx: BrowserHandlerContext, n: number) {
  for (let i = 0; i < n; i++) ctx.eventStore.insertEvent("s1", makeEvent());
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("handleSubscribe — windowing is keyed on CONTENT, not call site (E14, E15, E16)", () => {
  it("E14: a WARM session subscribed with lastSeq=0 is windowed, even though the delta branch serves it", async () => {
    // `:260` is dual-purpose: `lastSeq = msg.lastSeq ?? 0`, so a browser reload
    // with no cached seq against a still-warm server takes this branch with the
    // ENTIRE stream. Keying on call site would make maxReplayEvents a no-op for
    // warm reloads — the dominant reopen path.
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await settle();

    expect(windowsOf(ctx)).toHaveLength(1);
    expect(replayedEvents(ctx).length).toBeLessThanOrEqual(500);
    // D5: the windowed lastSeq=0 path resets explicitly rather than relying on
    // the reducer's `firstSeq === 1` store invariant.
    expect(sentOf(ctx).some((m) => m.type === "session_state_reset")).toBe(true);
  });

  it("E15: a GENUINE delta is never windowed and never emits history_window", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 900 }, new Set(), ctx);
    await settle();

    const events = replayedEvents(ctx);
    expect(events).toHaveLength(4100);
    // No seq gap after lastSeq — windowing a delta would punch one between what
    // the client holds and what it receives.
    expect(events[0].seq).toBe(901);
    expect(events.at(-1)!.seq).toBe(5000);
    expect(windowsOf(ctx)).toHaveLength(0);
  });

  it("E16: maxReplayEvents=0 delivers everything and reports no gap", async () => {
    const ctx = createMockContext({ maxReplayEvents: 0 });
    seed(ctx, 5000);
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await settle();

    expect(replayedEvents(ctx)).toHaveLength(5000);
    expect(windowsOf(ctx)).toHaveLength(0);
  });
});

describe("history_backfill — range and span (E27, E28, E29, E30, E31, P3)", () => {
  async function subscribed() {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();
    return { ctx, subs, win };
  }

  it("E27: an over-long span is CLAMPED, not refused", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 501 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.events.length).toBeLessThanOrEqual(BACKFILL_MAX_SPAN);
  });

  it("E28: a span exactly at the maximum is served whole with no error", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + BACKFILL_MAX_SPAN },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.events).toHaveLength(BACKFILL_MAX_SPAN);
  });

  it("E29: a range that does not intersect the gap is refused", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.tailMinSeq, toSeq: win.tailMinSeq + 10 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBe("out_of_range");
    expect(res.events).toEqual([]);
  });

  it("E30: an inverted range is refused", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 100, toSeq: win.headMaxSeq + 10 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBe("out_of_range");
    expect(res.events).toEqual([]);
  });

  it("E31: every served event lies STRICTLY inside the disclosed gap", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      // Deliberately overshoot on both sides; the server clamps into the gap.
      { type: "history_backfill", sessionId: "s1", fromSeq: 1, toSeq: 100000 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.events.length).toBeGreaterThan(0);
    for (const e of res.events) {
      expect(e.seq).toBeGreaterThan(win.headMaxSeq);
      expect(e.seq).toBeLessThan(win.tailMinSeq);
    }
  });

  it("P3: one max-span response stays within the per-event ceiling × the span", async () => {
    const { ctx, subs, win } = await subscribed();
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + BACKFILL_MAX_SPAN },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    const perEventCeiling = 4096;
    expect(JSON.stringify(res).length).toBeLessThanOrEqual(perEventCeiling * BACKFILL_MAX_SPAN);
  });

  it("a NON-head-adjacent request is served but does NOT advance the head", async () => {
    // `from` is clamped up to `headMaxSeq + 1` as a LOWER bound only, so a
    // client is free to ask for a range starting well above the head edge.
    // Advancing the head past events that were never served would permanently
    // orphan everything below, with the client's stop rule none the wiser.
    const { ctx, subs, win } = await subscribed();
    const before = peekGapState(ctx.ws, "s1")!.headMaxSeq;
    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 3000, toSeq: win.headMaxSeq + 3010 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(peekGapState(ctx.ws, "s1")!.headMaxSeq).toBe(before);
    // ...and the count still reflects everything above the UNMOVED head edge.
    expect(res.remainingGapCount).toBe(win.gapCount);
  });

  it("the head ADVANCES across successive requests, so remainingGapCount terminates", async () => {
    const { ctx, subs, win } = await subscribed();
    let remaining = win.gapCount;
    let guard = 0;
    while (remaining > 0 && guard++ < 20) {
      const gap = peekGapState(ctx.ws, "s1")!;
      await handleHistoryBackfill(
        { type: "history_backfill", sessionId: "s1", fromSeq: gap.headMaxSeq + 1, toSeq: gap.headMaxSeq + BACKFILL_MAX_SPAN },
        subs,
        ctx,
      );
      const res = resultsOf(ctx).at(-1)!;
      expect(res.error).toBeUndefined();
      expect(res.remainingGapCount).toBeLessThan(remaining);
      remaining = res.remainingGapCount;
    }
    expect(remaining).toBe(0);
  });
});

describe("history_backfill — refusal paths (X1, X2, X3, X4, X6)", () => {
  it("X1: an unsubscribed session is refused WITHOUT reading the store", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    const spy = vi.spyOn(ctx.eventStore, "getEventsRange");
    await handleHistoryBackfill({ type: "history_backfill", sessionId: "s1", fromSeq: 10, toSeq: 20 }, new Set(), ctx);

    const [res] = resultsOf(ctx);
    expect(res.error).toBe("not_subscribed");
    expect(res.events).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("X2: a concurrent request is refused in_flight, and the FIRST still gets its own response", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();

    const req = { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 10 } as const;
    const first = handleHistoryBackfill(req, subs, ctx);
    // Issued while the first is still awaiting its yield.
    await handleHistoryBackfill(req, subs, ctx);
    await first;

    const results = resultsOf(ctx);
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.error === "in_flight")).toHaveLength(1);
    expect(results.filter((r) => r.error === undefined)).toHaveLength(1);
  });

  it("X3: a completion after a re-subscribe is answered stale_generation, not dropped", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();

    const inflight = handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 10 },
      subs,
      ctx,
    );
    // Re-subscribe races the in-flight backfill: its result was computed
    // against the OLD window and could overlap the new head or tail.
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await inflight;

    const stale = resultsOf(ctx).filter((r) => r.error === "stale_generation");
    expect(stale).toHaveLength(1);
    expect(stale[0].events).toEqual([]);
  });

  it("X4: EXACTLY one response per request on every refusal path — never zero, never two", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];

    const cases = [
      { label: "not_subscribed", subs: new Set<string>(), fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 5 },
      { label: "out_of_range (outside)", subs, fromSeq: win.tailMinSeq, toSeq: win.tailMinSeq + 5 },
      { label: "out_of_range (inverted)", subs, fromSeq: win.headMaxSeq + 50, toSeq: win.headMaxSeq + 1 },
      { label: "served", subs, fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 5 },
    ];
    for (const c of cases) {
      (ctx.sendTo as any).mockClear();
      await handleHistoryBackfill(
        { type: "history_backfill", sessionId: "s1", fromSeq: c.fromSeq, toSeq: c.toSeq },
        c.subs,
        ctx,
      );
      expect(resultsOf(ctx), c.label).toHaveLength(1);
    }
  });

  it("X6: backfill is served from the STORE — the session file is never read", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seed(ctx, 5000);
    // An unreadable session file: a disk read would reject, and serving
    // backfill from disk is an explicit Non-Goal.
    const loadSessionEvents = vi.fn(async () => {
      throw new Error("session file is unreadable");
    });
    (ctx as { directoryService?: unknown }).directoryService = { loadSessionEvents, cancelLoad: vi.fn() };

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();

    await handleHistoryBackfill(
      { type: "history_backfill", sessionId: "s1", fromSeq: win.headMaxSeq + 1, toSeq: win.headMaxSeq + 10 },
      subs,
      ctx,
    );
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.events.length).toBeGreaterThan(0);
    expect(loadSessionEvents).not.toHaveBeenCalled();
  });
});

/**
 * Symmetric-gap backfill — test-plan scenarios E13–E23 and X4.
 *
 * The gap is bounded on BOTH sides and both edges are mutable now, so the two
 * properties under test are (a) which edge a served range is credited to, and
 * (b) that the credited bound is the POST-SNAP served one, not the requested
 * one. See change: fix-lazy-history-backfill-ux (D1, D1a, D4, D4a).
 */
describe("history_backfill — symmetric gap (E13–E23, X4)", () => {
  /**
   * Seeds `n` events, overriding the eventType at specific SEQS. Seqs are
   * 1-based and dense, so seq === index + 1.
   *
   * Every override below sits strictly inside the gap, never inside either
   * snap-scan range of `computeReplayWindow` itself, so the announced window
   * geometry stays the deterministic `headMaxSeq: 50` / `tailMinSeq: 4551`
   * that these assertions are written against.
   */
  function seedWithTypes(ctx: BrowserHandlerContext, n: number, overrides: Record<number, string> = {}) {
    for (let i = 1; i <= n; i++) ctx.eventStore.insertEvent("s1", makeEvent(overrides[i] ?? "tool_execution_end"));
  }

  async function primed(n = 5000, overrides: Record<number, string> = {}) {
    const ctx = createMockContext({ maxReplayEvents: 500 });
    seedWithTypes(ctx, n, overrides);
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settle();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();
    return { ctx, subs, win };
  }

  const backfill = (ctx: BrowserHandlerContext, subs: Set<string>, fromSeq: number, toSeq: number) =>
    handleHistoryBackfill({ type: "history_backfill", sessionId: "s1", fromSeq, toSeq }, subs, ctx);

  it("the window geometry these scenarios assume is the one actually announced", async () => {
    const { win } = await primed();
    expect(win.headMaxSeq).toBe(50);
    expect(win.tailMinSeq).toBe(4551);
  });

  /**
   * E13 — the crediting decision table. Crediting is EXCLUSIVE, so the
   * both-adjacent row is a real decision and not an implementation detail:
   * credit the TAIL, keeping one consistent direction of travel (D1a).
   */
  describe("E13: edge crediting is exclusive and orientation-driven", () => {
    // A gap SMALLER than one max span, so a request can abut both edges at once
    // without the span clamp destroying one of the adjacencies.
    const small = () => primed(800);

    it("(head-adjacent, tail-adjacent) credits the TAIL and leaves the head alone", async () => {
      const { ctx, subs, win } = await small();
      await backfill(ctx, subs, win.headMaxSeq + 1, win.tailMinSeq - 1);
      const gap = peekGapState(ctx.ws, "s1")!;
      expect(gap.tailMinSeq).toBe(win.headMaxSeq + 1);
      expect(gap.headMaxSeq).toBe(win.headMaxSeq);
    });

    it("(head-adjacent, NOT tail-adjacent) credits the head", async () => {
      const { ctx, subs, win } = await small();
      const to = win.tailMinSeq - 20;
      await backfill(ctx, subs, win.headMaxSeq + 1, to);
      const gap = peekGapState(ctx.ws, "s1")!;
      expect(gap.headMaxSeq).toBe(to);
      expect(gap.tailMinSeq).toBe(win.tailMinSeq);
    });

    it("(NOT head-adjacent, tail-adjacent) credits the tail", async () => {
      const { ctx, subs, win } = await small();
      const from = win.headMaxSeq + 20;
      await backfill(ctx, subs, from, win.tailMinSeq - 1);
      const gap = peekGapState(ctx.ws, "s1")!;
      expect(gap.tailMinSeq).toBe(from);
      expect(gap.headMaxSeq).toBe(win.headMaxSeq);
    });

    it("(neither) serves the events and credits NOTHING", async () => {
      const { ctx, subs, win } = await small();
      await backfill(ctx, subs, win.headMaxSeq + 20, win.tailMinSeq - 20);
      const [res] = resultsOf(ctx);
      expect(res.error).toBeUndefined();
      expect(res.events.length).toBeGreaterThan(0);
      const gap = peekGapState(ctx.ws, "s1")!;
      expect(gap.headMaxSeq).toBe(win.headMaxSeq);
      expect(gap.tailMinSeq).toBe(win.tailMinSeq);
    });
  });

  /**
   * E14/E15 — the span clamp must move the NON-abutting bound (D4a). Lowering
   * `to` on a tail-adjacent request would destroy the adjacency the response is
   * credited for: the server would credit nothing while the client still
   * retreats its own `tailMinSeq`, and the next derived range inverts into a
   * permanent `out_of_range` loop.
   */
  it("E14: an over-long TAIL-adjacent request raises `from`, keeping the tail credited", async () => {
    const { ctx, subs, win } = await primed();
    await backfill(ctx, subs, win.tailMinSeq - 900, win.tailMinSeq - 1);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.servedTo).toBe(win.tailMinSeq - 1);
    expect(res.servedFrom).toBe(win.tailMinSeq - BACKFILL_MAX_SPAN);
    expect(res.servedFrom).toBeGreaterThan(win.tailMinSeq - 900);
    expect(peekGapState(ctx.ws, "s1")!.tailMinSeq).toBe(res.servedFrom);
  });

  it("E15: an over-long HEAD-adjacent request lowers `to`, keeping the head credited", async () => {
    const { ctx, subs, win } = await primed();
    await backfill(ctx, subs, win.headMaxSeq + 1, win.headMaxSeq + 900);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.servedFrom).toBe(win.headMaxSeq + 1);
    expect(res.servedTo).toBe(win.headMaxSeq + BACKFILL_MAX_SPAN);
    expect(res.servedTo).toBeLessThan(win.headMaxSeq + 900);
    expect(peekGapState(ctx.ws, "s1")!.headMaxSeq).toBe(res.servedTo);
  });

  /**
   * E18–E22 — gap-facing edge snapping. The snap may only SHRINK, is bounded by
   * `SNAP_LOOKUP`, and must never empty the slice: an empty `events` array is
   * the client's TERMINATION signal, so an over-eager snap would silently
   * strand the gap.
   */
  it("E18/E21: a tail-anchored slice snaps its LOWER edge, and the tail is credited POST-snap", async () => {
    // A completed message boundary 40 events into the slice.
    const { ctx, subs, win } = await primed(5000, { 4090: "message_end", 4091: "message_start" });
    await backfill(ctx, subs, win.tailMinSeq - BACKFILL_MAX_SPAN, win.tailMinSeq - 1);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    // E18: the served range BEGINS at the boundary, not at the raw cut.
    expect(res.servedFrom).toBe(4091);
    expect(res.events[0].seq).toBe(4091);
    // E21: the recorded edge is the post-snap bound, never the pre-snap one.
    expect(peekGapState(ctx.ws, "s1")!.tailMinSeq).toBe(4091);
    expect(peekGapState(ctx.ws, "s1")!.tailMinSeq).not.toBe(win.tailMinSeq - BACKFILL_MAX_SPAN);
  });

  it("E19: no boundary within SNAP_LOOKUP serves the RAW cut, with no error", async () => {
    const { ctx, subs, win } = await primed();
    const from = win.tailMinSeq - BACKFILL_MAX_SPAN;
    await backfill(ctx, subs, from, win.tailMinSeq - 1);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.servedFrom).toBe(from);
  });

  it("E20: a snap that would empty the slice is not applied, and the gap is not reported exhausted", async () => {
    const from = 4551 - BACKFILL_MAX_SPAN;
    // The ONLY boundary is the slice's own first event.
    const { ctx, subs, win } = await primed(5000, { [from]: "message_start" });
    await backfill(ctx, subs, from, win.tailMinSeq - 1);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    expect(res.servedFrom).toBe(from);
    expect(res.events.length).toBeGreaterThan(0);
    expect(res.remainingGapCount).toBeGreaterThan(0);
  });

  it("E22: a head-anchored request snaps its UPPER edge instead, chosen by orientation", async () => {
    const { ctx, subs, win } = await primed(5000, { 500: "message_end" });
    await backfill(ctx, subs, win.headMaxSeq + 1, win.headMaxSeq + BACKFILL_MAX_SPAN);
    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    // Lower edge untouched (it is not the gap-facing one for this orientation).
    expect(res.servedFrom).toBe(win.headMaxSeq + 1);
    expect(res.servedTo).toBe(500);
    expect(res.events.at(-1)!.seq).toBe(500);
    expect(peekGapState(ctx.ws, "s1")!.headMaxSeq).toBe(500);
  });

  /**
   * E23/X4 — `remainingGapCount` is a STORE READ, never seq arithmetic. A
   * middle-trimmed store makes the seq distance an overstatement, and a divider
   * reading "N earlier messages" would then promise rows trimmed months ago.
   */
  describe("a holey store", () => {
    const HOLE_LO = 2000;
    const HOLE_HI = 3000;

    async function holey() {
      const p = await primed();
      const real = p.ctx.eventStore.getEventsRange.bind(p.ctx.eventStore);
      p.ctx.eventStore.getEventsRange = ((sid: string, from: number, to: number) =>
        real(sid, from, to).filter((e) => e.seq < HOLE_LO || e.seq > HOLE_HI)) as any;
      return p;
    }

    it("E23: remainingGapCount equals the STORED count, strictly below the seq distance", async () => {
      const { ctx, subs, win } = await holey();
      await backfill(ctx, subs, win.tailMinSeq - 10, win.tailMinSeq - 1);
      const [res] = resultsOf(ctx);
      const gap = peekGapState(ctx.ws, "s1")!;
      const seqDistance = gap.tailMinSeq - gap.headMaxSeq - 1;
      expect(res.remainingGapCount).toBeLessThan(seqDistance);
      expect(res.remainingGapCount).toBe(seqDistance - (HOLE_HI - HOLE_LO + 1));
    });

    it("X4: a range inside the gap but absent from the store is EMPTY, not an error", async () => {
      const { ctx, subs } = await holey();
      await backfill(ctx, subs, HOLE_LO + 10, HOLE_HI - 10);
      const [res] = resultsOf(ctx);
      expect(res.error).toBeUndefined();
      expect(res.events).toEqual([]);
      // Still truthful about what remains: unservable here, not exhausted.
      expect(res.remainingGapCount).toBeGreaterThan(0);
    });
  });

  it("walking DOWN from the tail terminates, exactly as the head walk does", async () => {
    const { ctx, subs, win } = await primed();
    let remaining = win.gapCount;
    let guard = 0;
    while (remaining > 0 && guard++ < 20) {
      const gap = peekGapState(ctx.ws, "s1")!;
      // The client's own `nextBackfillRange` shape: walk DOWN from the tail.
      const toSeq = gap.tailMinSeq - 1;
      const fromSeq = Math.max(gap.headMaxSeq + 1, toSeq - BACKFILL_MAX_SPAN + 1);
      await backfill(ctx, subs, fromSeq, toSeq);
      const res = resultsOf(ctx).at(-1)!;
      expect(res.error).toBeUndefined();
      expect(res.remainingGapCount).toBeLessThan(remaining);
      remaining = res.remainingGapCount;
    }
    expect(remaining).toBe(0);
  });
});

/**
 * Edge crediting never credits an ABSENT head — D4.
 *
 * `headAdjacent = from === headMaxSeq + 1` is TRUE for the final slice of an
 * untrimmed `tail-only` gap (`from === 1`, `headMaxSeq === 0`), so without an
 * explicit `hasHead` the head credit fires on a head that does not exist and
 * sets `headMaxSeq = to`, poisoning every later `remainingGapCount`.
 * See change: add-tail-only-replay-window (D4), test-plan E10/E11.
 */
describe("history_backfill — edge crediting in a head-free window (E10, E11)", () => {
  const settleFor = () => new Promise((r) => setTimeout(r, 50));

  async function primedTailOnly(n = 5000) {
    const ctx = createMockContext({ maxReplayEvents: 500, replayWindowMode: "tail-only" });
    for (let i = 1; i <= n; i++) ctx.eventStore.insertEvent("s1", makeEvent());
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settleFor();
    const win = windowsOf(ctx)[0];
    (ctx.sendTo as any).mockClear();
    return { ctx, subs, win };
  }

  /**
   * #E10 — a request whose `from` is `1` LOOKS head-adjacent against
   * `headMaxSeq: 0`. The tail must retreat, the head must stay pinned at `0`,
   * and `remainingGapCount` must still agree with what the store holds.
   */
  it("E10: from=1 against headMaxSeq=0 credits the TAIL and never advances the head", async () => {
    const { ctx, subs, win } = await primedTailOnly();
    expect(win.headMaxSeq).toBe(0);
    expect(win.windowShape).toBe("tail-only");
    const gapBefore = peekGapState(ctx.ws, "s1")!;
    expect(gapBefore.hasHead).toBe(false);

    // Tail-anchored slice reaching all the way down to seq 1.
    const to = win.tailMinSeq - 1;
    const from = Math.max(1, to - BACKFILL_MAX_SPAN + 1);
    await backfillOn(ctx, subs, from, to);

    const gap = peekGapState(ctx.ws, "s1")!;
    expect(gap.headMaxSeq).toBe(0);
    expect(gap.tailMinSeq).toBeLessThan(win.tailMinSeq);

    const [res] = resultsOf(ctx);
    expect(res.error).toBeUndefined();
    // `remainingGapCount` must match a real store read, not a poisoned bound.
    const stillHeld = ctx.eventStore
      .getEvents("s1", 1)
      .filter((e) => e.seq > gap.headMaxSeq && e.seq < gap.tailMinSeq).length;
    expect(res.remainingGapCount).toBe(stillHeld);
  });

  /**
   * #E10 (walk to the floor) — the whole point of gating the head credit: an
   * untrimmed tail-only gap walks down to seq 1 with `headMaxSeq` pinned at 0
   * the entire way, and `remainingGapCount` reaches 0 rather than being
   * corrupted by a phantom head credit.
   */
  it("E10: the walk terminates at seq 1 with the head pinned at 0 throughout", async () => {
    const { ctx, subs, win } = await primedTailOnly();
    let tail = win.tailMinSeq;
    let remaining = win.gapCount;
    for (let i = 0; i < 20 && remaining > 0; i++) {
      const to = tail - 1;
      const from = Math.max(1, to - BACKFILL_MAX_SPAN + 1);
      (ctx.sendTo as any).mockClear();
      await backfillOn(ctx, subs, from, to);
      const [res] = resultsOf(ctx);
      expect(res.error).toBeUndefined();
      const gap = peekGapState(ctx.ws, "s1")!;
      expect(gap.headMaxSeq).toBe(0);
      expect(res.remainingGapCount).toBeLessThan(remaining);
      remaining = res.remainingGapCount;
      tail = gap.tailMinSeq;
    }
    expect(remaining).toBe(0);
    expect(tail).toBe(1);
  });

  /**
   * #E11 — the contrast row. In a `head-tail` window `hasHead` is true, so the
   * both-adjacent rule from `fix-lazy-history-backfill-ux` (D1a) is unchanged:
   * the tail is credited, the head is not.
   */
  it("E11: a range abutting BOTH edges in a head-tail window still credits only the tail", async () => {
    const ctx = createMockContext({ maxReplayEvents: 500, replayWindowMode: "head-tail" });
    for (let i = 1; i <= 800; i++) ctx.eventStore.insertEvent("s1", makeEvent());
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await settleFor();
    const win = windowsOf(ctx)[0];
    expect(win.headMaxSeq).toBeGreaterThanOrEqual(1);
    expect(peekGapState(ctx.ws, "s1")!.hasHead).toBe(true);
    (ctx.sendTo as any).mockClear();

    await backfillOn(ctx, subs, win.headMaxSeq + 1, win.tailMinSeq - 1);
    const gap = peekGapState(ctx.ws, "s1")!;
    expect(gap.tailMinSeq).toBe(win.headMaxSeq + 1);
    expect(gap.headMaxSeq).toBe(win.headMaxSeq);
  });
});

const backfillOn = (ctx: BrowserHandlerContext, subs: Set<string>, fromSeq: number, toSeq: number) =>
  handleHistoryBackfill({ type: "history_backfill", sessionId: "s1", fromSeq, toSeq }, subs, ctx);
