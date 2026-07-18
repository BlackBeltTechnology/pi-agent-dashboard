import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { handleSubscribe, replaySessionAssets } from "../browser-handlers/subscription-handler.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

function makeEvent(type: string = "test"): DashboardEvent {
  return { eventType: type, timestamp: Date.now(), data: {} };
}

function createMockContext(overrides: Partial<BrowserHandlerContext> = {}): BrowserHandlerContext {
  return {
    ws: { readyState: 1, OPEN: 1, bufferedAmount: 0 } as any,
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
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
    ...overrides,
  };
}

describe("handleSubscribe — metadata requests on subscribe", () => {
  it("sends request_commands, request_models, request_providers, and request_roles to piGateway", () => {
    // request_providers added by change: replace-hardcoded-provider-lists.
    const ctx = createMockContext();
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1" }, subs, ctx);

    const calls = (ctx.piGateway.sendToSession as any).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual(["s1", { type: "request_commands", sessionId: "s1" }]);
    expect(calls[1]).toEqual(["s1", { type: "request_models", sessionId: "s1" }]);
    expect(calls[2]).toEqual(["s1", { type: "request_providers", sessionId: "s1" }]);
    expect(calls[3]).toEqual(["s1", { type: "request_roles", sessionId: "s1" }]);
  });
});

describe("handleSubscribe — stale lastSeq detection", () => {
  it("replays delta when lastSeq is within server range", async () => {
    const ctx = createMockContext();
    // Insert 5 events
    for (let i = 0; i < 5; i++) ctx.eventStore.insertEvent("s1", makeEvent(`e${i}`));

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 3 }, subs, ctx);

    // Wait for async replay
    await new Promise((r) => setTimeout(r, 50));

    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    // Should NOT have sent session_state_reset
    const resets = calls.filter(([, msg]) => msg.type === "session_state_reset");
    expect(resets).toHaveLength(0);

    // Should have replayed only events 4 and 5
    const replays = calls.filter(([, msg]) => msg.type === "event_replay");
    expect(replays.length).toBeGreaterThanOrEqual(1);
    const allEvents = replays.flatMap(([, msg]: any) => msg.events);
    expect(allEvents).toHaveLength(2);
    expect(allEvents[0].seq).toBe(4);
    expect(allEvents[1].seq).toBe(5);
  });

  it("sends session_state_reset and full replay when lastSeq > server maxSeq", async () => {
    const ctx = createMockContext();
    // Insert 3 events (maxSeq = 3)
    for (let i = 0; i < 3; i++) ctx.eventStore.insertEvent("s1", makeEvent(`e${i}`));

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 100 }, subs, ctx);

    // Wait for async replay
    await new Promise((r) => setTimeout(r, 50));

    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    // Should have sent session_state_reset first
    const resets = calls.filter(([, msg]) => msg.type === "session_state_reset");
    expect(resets).toHaveLength(1);

    // Should have replayed ALL events from seq 1
    const replays = calls.filter(([, msg]) => msg.type === "event_replay");
    const allEvents = replays.flatMap(([, msg]: any) => msg.events);
    expect(allEvents).toHaveLength(3);
    expect(allEvents[0].seq).toBe(1);
  });

  it("marks replaying during delta replay and clears after", async () => {
    const markReplaying = vi.fn();
    const clearReplaying = vi.fn();
    const ctx = createMockContext({ markReplaying, clearReplaying });
    for (let i = 0; i < 5; i++) ctx.eventStore.insertEvent("s1", makeEvent());

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 3 }, subs, ctx);

    await new Promise((r) => setTimeout(r, 50));

    expect(markReplaying).toHaveBeenCalledWith(ctx.ws, "s1");
    expect(clearReplaying).toHaveBeenCalledWith(ctx.ws, "s1", 5); // lastSent = 5
  });

  it("marks replaying for fresh subscribe (lastSeq: 0) when events exist", async () => {
    // Regression: cold subscribe must suppress live events during paginated
    // replay. Without suppression, a live `event` arriving between batches
    // bumps the client's maxSeq past the next batch's firstSeq, triggering
    // the `firstSeq <= maxSeq` reset rule on the client which wipes state
    // and rebuilds from only the last batch — leaving the chat showing
    // only the tail messages.
    // See change: fix-cold-subscribe-replay-interleave.
    const markReplaying = vi.fn();
    const clearReplaying = vi.fn();
    const ctx = createMockContext({ markReplaying, clearReplaying });
    for (let i = 0; i < 3; i++) ctx.eventStore.insertEvent("s1", makeEvent());

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);

    await new Promise((r) => setTimeout(r, 50));

    expect(markReplaying).toHaveBeenCalledWith(ctx.ws, "s1");
    expect(clearReplaying).toHaveBeenCalledWith(ctx.ws, "s1", 3); // lastSent = 3
  });

  it("does not mark replaying for fresh subscribe when there are no events", async () => {
    const markReplaying = vi.fn();
    const ctx = createMockContext({ markReplaying });
    // No events inserted — hasEvents() returns false; falls through to the
    // empty-session branch.
    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);

    await new Promise((r) => setTimeout(r, 50));

    expect(markReplaying).not.toHaveBeenCalled();
  });

  it("marks replaying during stale lastSeq full replay", async () => {
    const markReplaying = vi.fn();
    const clearReplaying = vi.fn();
    const ctx = createMockContext({ markReplaying, clearReplaying });
    for (let i = 0; i < 3; i++) ctx.eventStore.insertEvent("s1", makeEvent());

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 100 }, subs, ctx);

    await new Promise((r) => setTimeout(r, 50));

    expect(markReplaying).toHaveBeenCalledWith(ctx.ws, "s1");
    expect(clearReplaying).toHaveBeenCalledWith(ctx.ws, "s1", 3);
  });

  it("forwards session.contextWindow into directoryService.loadSessionEvents on lazy load", async () => {
    // Regression: ended sessions opened from disk must replay with the
    // persisted contextWindow (e.g. 1M Sonnet beta) instead of the legacy
    // 200k Claude inference. The wiring lives in subscription-handler:160 —
    // this test pins that loadSessionEvents is invoked with session.contextWindow
    // as its 3rd argument so future refactors cannot silently drop it.
    // See change: fix-context-window-reload.
    const loadSessionEvents = vi.fn(async () => ({ success: true, events: [] }));
    const directoryService = { loadSessionEvents } as any;
    const ctx = createMockContext({ directoryService });

    // Restore an ENDED session with sessionFile + persisted contextWindow.
    // No events in the store → falls into the lazy-load branch.
    // (`restore()` takes the full DashboardSession; `register()` does not
    // accept contextWindow as a registration param.)
    ctx.sessionManager.restore({
      id: "s-ctx",
      cwd: "/test",
      source: "tui",
      status: "ended",
      startedAt: 1000,
      endedAt: 2000,
      tokensIn: 0,
      tokensOut: 0,
      cost: 0,
      contextWindow: 1_000_000,
      sessionFile: "/sessions/s-ctx.jsonl",
      sessionDir: "/sessions",
      hidden: false,
    } as any);

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s-ctx" }, subs, ctx);

    await new Promise((r) => setTimeout(r, 20));

    expect(loadSessionEvents).toHaveBeenCalledTimes(1);
    expect(loadSessionEvents).toHaveBeenCalledWith("s-ctx", "/sessions/s-ctx.jsonl", 1_000_000);
  });

  it("does full replay when lastSeq is 0", async () => {
    const ctx = createMockContext();
    for (let i = 0; i < 3; i++) ctx.eventStore.insertEvent("s1", makeEvent());

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);

    await new Promise((r) => setTimeout(r, 50));

    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    const resets = calls.filter(([, msg]) => msg.type === "session_state_reset");
    expect(resets).toHaveLength(0); // No reset needed for fresh subscribe

    const replays = calls.filter(([, msg]) => msg.type === "event_replay");
    const allEvents = replays.flatMap(([, msg]: any) => msg.events);
    expect(allEvents).toHaveLength(3);
  });
});

// chat-markdown-local-images-and-math
describe("replaySessionAssets — emits one asset_register per Session.assets entry", () => {
  it("sends nothing when session has no assets", () => {
    const ctx = createMockContext();
    ctx.sessionManager.register({ id: "s1", cwd: "/c", source: "dashboard" } as any);
    replaySessionAssets({} as any, "s1", ctx);
    expect((ctx.sendTo as any).mock.calls).toHaveLength(0);
  });

  it("sends one asset_register per asset on the session", () => {
    const ctx = createMockContext();
    ctx.sessionManager.register({ id: "s1", cwd: "/c", source: "dashboard" } as any);
    ctx.sessionManager.update("s1", {
      assets: {
        abc: { data: "AAAA", mimeType: "image/png" },
        def: { data: "BBBB", mimeType: "image/svg+xml" },
      },
    } as any);
    const ws = {} as any;
    replaySessionAssets(ws, "s1", ctx);
    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    const assetMsgs = calls.filter(([, m]) => m.type === "asset_register");
    expect(assetMsgs).toHaveLength(2);
    const byHash = Object.fromEntries(assetMsgs.map(([, m]: any) => [m.hash, m]));
    expect(byHash.abc).toMatchObject({ data: "AAAA", mimeType: "image/png", sessionId: "s1" });
    expect(byHash.def).toMatchObject({ data: "BBBB", mimeType: "image/svg+xml", sessionId: "s1" });
  });

  it("skips malformed asset entries defensively", () => {
    const ctx = createMockContext();
    ctx.sessionManager.register({ id: "s1", cwd: "/c", source: "dashboard" } as any);
    // Force a malformed entry past the type check.
    ctx.sessionManager.update("s1", {
      assets: {
        good: { data: "AAAA", mimeType: "image/png" },
        bad: { data: 123, mimeType: "image/png" } as any,
      },
    } as any);
    replaySessionAssets({} as any, "s1", ctx);
    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    const assetMsgs = calls.filter(([, m]) => m.type === "asset_register");
    expect(assetMsgs).toHaveLength(1);
    expect((assetMsgs[0][1] as any).hash).toBe("good");
  });
});

// fix-history-loading-false-empty-flash
describe("handleSubscribe — cold-hydration heartbeat", () => {
  // Fake only timers, NOT setImmediate — sendEventBatches yields via real
  // setImmediate so batches still flush under `flush()`.
  const TO_FAKE = ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] as const;
  const HEARTBEAT_MS = 10000;

  async function flush() {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  }

  function restoreEnded(ctx: BrowserHandlerContext, id: string) {
    ctx.sessionManager.restore({
      id, cwd: "/test", source: "tui", status: "ended",
      startedAt: 1000, endedAt: 2000, tokensIn: 0, tokensOut: 0, cost: 0,
      contextWindow: 200000, sessionFile: `/sessions/${id}.jsonl`,
      sessionDir: "/sessions", hidden: false,
    } as any);
  }

  function emptyNonTerminal(ctx: BrowserHandlerContext) {
    return ((ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>).filter(
      ([, m]) => m.type === "event_replay" && (m as any).events.length === 0 && (m as any).isLast === false,
    );
  }

  it("4.7 emits >=1 heartbeat before a delayed loadSessionEvents resolves", () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] });
    try {
      const loadSessionEvents = vi.fn(() => new Promise(() => {})); // never resolves
      const ctx = createMockContext({ directoryService: { loadSessionEvents } as any });
      ctx.getSubscribers = () => [ctx.ws];
      restoreEnded(ctx, "s-cold");

      handleSubscribe({ type: "subscribe", sessionId: "s-cold" }, new Set(), ctx);
      // priming marker sent synchronously; one interval tick adds a heartbeat.
      vi.advanceTimersByTime(HEARTBEAT_MS + 1);
      expect(emptyNonTerminal(ctx).length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("4.8 heartbeat stops once the first content batch flows; none after", async () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] });
    try {
      const events = [makeEvent("message_update")];
      const loadSessionEvents = vi.fn(async () => ({ success: true, events }));
      const ctx = createMockContext({ directoryService: { loadSessionEvents } as any });
      ctx.getSubscribers = () => [ctx.ws];
      restoreEnded(ctx, "s-content");

      handleSubscribe({ type: "subscribe", sessionId: "s-content" }, new Set(), ctx);
      await flush(); // load resolves + content batch sends; stopHeartbeat runs

      const before = emptyNonTerminal(ctx).length; // priming only
      vi.advanceTimersByTime(HEARTBEAT_MS * 3);
      expect(emptyNonTerminal(ctx).length).toBe(before);

      const content = ((ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>)
        .filter(([, m]) => m.type === "event_replay" && (m as any).events.length > 0);
      expect(content.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("4.9 heartbeat stops on failure and on cancelled", async () => {
    for (const err of ["boom", "cancelled"]) {
      vi.useFakeTimers({ toFake: [...TO_FAKE] });
      try {
        const loadSessionEvents = vi.fn(async () => ({ success: false, error: err }));
        const ctx = createMockContext({ directoryService: { loadSessionEvents } as any });
        ctx.getSubscribers = () => [ctx.ws];
        restoreEnded(ctx, `s-${err}`);

        handleSubscribe({ type: "subscribe", sessionId: `s-${err}` }, new Set(), ctx);
        await flush();

        const before = emptyNonTerminal(ctx).length;
        vi.advanceTimersByTime(HEARTBEAT_MS * 3);
        expect(emptyNonTerminal(ctx).length).toBe(before);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  it("4.9 heartbeat never sends to a closed subscriber socket", () => {
    vi.useFakeTimers({ toFake: [...TO_FAKE] });
    try {
      const closedSub = { readyState: 3, OPEN: 1 } as any;
      const loadSessionEvents = vi.fn(() => new Promise(() => {}));
      const ctx = createMockContext({ directoryService: { loadSessionEvents } as any });
      ctx.getSubscribers = () => [closedSub];
      restoreEnded(ctx, "s-closed");

      handleSubscribe({ type: "subscribe", sessionId: "s-closed" }, new Set(), ctx);
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);

      const sentToClosed = ((ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>)
        .some(([w]) => w === closedSub);
      expect(sentToClosed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleSubscribe — asset replay precedes events", () => {
  it("sends asset_register messages before event_replay batches", async () => {
    const ctx = createMockContext();
    ctx.sessionManager.register({ id: "s1", cwd: "/c", source: "dashboard" } as any);
    ctx.sessionManager.update("s1", {
      assets: { h1: { data: "AAAA", mimeType: "image/png" } },
    } as any);
    ctx.eventStore.insertEvent("s1", makeEvent("message_update"));

    const subs = new Set<string>();
    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, subs, ctx);
    await new Promise((r) => setTimeout(r, 50));

    const calls = (ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>;
    const firstAssetIdx = calls.findIndex(([, m]) => m.type === "asset_register");
    const firstEventIdx = calls.findIndex(([, m]) => m.type === "event_replay");
    expect(firstAssetIdx).toBeGreaterThanOrEqual(0);
    expect(firstEventIdx).toBeGreaterThanOrEqual(0);
    expect(firstAssetIdx).toBeLessThan(firstEventIdx);
  });
});
