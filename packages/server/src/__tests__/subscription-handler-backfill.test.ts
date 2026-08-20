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
