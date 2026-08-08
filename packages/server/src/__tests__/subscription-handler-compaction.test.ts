/**
 * Handler-level integration for replay compaction — test-plan scenarios
 * E10/E11/E12 (batch size), X1 (pre-compaction high-water mark), X2 (catch-up),
 * X4 (socket close), X5 (backpressure), X6/X7 (unchanged paths).
 *
 * See change: compact-warm-replay-stream.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { handleSubscribe, sendEventBatches } from "../browser-handlers/subscription-handler.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";

const REPLAY_BATCH_SIZE = 200;

function makeEvent(eventType = "test", data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: Date.now(), data };
}

function assistantUpdate(text: string): DashboardEvent {
  return makeEvent("message_update", { message: { role: "assistant", content: [{ type: "text", text }] } });
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
    replayNotifyLog: vi.fn(),
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
    ...overrides,
  };
}

const replayBatches = (ctx: BrowserHandlerContext) =>
  ((ctx.sendTo as any).mock.calls as Array<[any, ServerToBrowserMessage]>)
    .map(([, m]) => m)
    .filter((m): m is Extract<ServerToBrowserMessage, { type: "event_replay" }> => m.type === "event_replay");

function window(n: number, make: (i: number) => DashboardEvent): StoredEvent[] {
  return Array.from({ length: n }, (_, i) => ({ seq: i + 1, event: make(i) }));
}

const openWs = () => ({ readyState: 1, OPEN: 1, bufferedAmount: 0 }) as any;

describe("sendEventBatches — batch-size boundaries (E10/E11/E12)", () => {
  // Non-compactable events so the batch maths is not confounded by compaction.
  const sendAll = async (n: number) => {
    const sent: any[] = [];
    const seq = await sendEventBatches(openWs(), "s1", window(n, () => makeEvent("turn_start")), (_w, m) =>
      sent.push(m),
    );
    return { batches: sent.filter((m) => m.type === "event_replay"), seq };
  };

  it("E10: exactly 200 events → 1 batch with isLast:true", async () => {
    const { batches } = await sendAll(200);
    expect(batches).toHaveLength(1);
    expect(batches[0].events).toHaveLength(200);
    expect(batches[0].isLast).toBe(true);
  });

  it("E11: 201 events → 2 batches sized 200 + 1; only the last has isLast:true", async () => {
    const { batches } = await sendAll(201);
    expect(batches.map((b) => b.events.length)).toEqual([200, 1]);
    expect(batches.map((b) => b.isLast)).toEqual([false, true]);
  });

  it("E12: 1000 events → exactly 5 batches", async () => {
    const { batches } = await sendAll(1000);
    expect(batches).toHaveLength(5);
    expect(batches.filter((b) => b.isLast)).toHaveLength(1);
    expect(REPLAY_BATCH_SIZE).toBe(200);
  });
});

describe("sendEventBatches — high-water mark and fault paths", () => {
  it("X1: reports the PRE-compaction max seq, never the last surviving one", async () => {
    // seqs 1..100: message_start, superseded updates 2..99, message_end at 100.
    // 98 events are dropped; the reported high-water mark must still be 100.
    //
    // NOTE on reachability: under the shipped positional rule the window's LAST
    // event can never be dropped (a `message_update` is only superseded by a
    // LATER `message_end`), so the returned value happens to coincide with the
    // last surviving seq today. D4 is a defensive contract — this test pins it
    // so a future narrowing of the rule cannot silently regress `clearReplaying`
    // into re-sending already-delivered events.
    const stored: StoredEvent[] = [{ seq: 1, event: makeEvent("message_start") }];
    for (let s = 2; s <= 99; s++) stored.push({ seq: s, event: assistantUpdate(`t${s}`) });
    stored.push({ seq: 100, event: makeEvent("message_end") });

    const sent: any[] = [];
    const returned = await sendEventBatches(openWs(), "s1", stored, (_w, m) => sent.push(m));
    const delivered = sent.flatMap((m) => m.events.map((e: any) => e.seq));
    expect(delivered).toEqual([1, 100]);
    expect(returned).toBe(100);
    expect(returned).toBeGreaterThanOrEqual(Math.max(...delivered));
  });

  it("X4: socket closed mid-replay → returns 0 and stops sending", async () => {
    const ws = { readyState: 1, OPEN: 1, bufferedAmount: 0 } as any;
    const sent: any[] = [];
    const stored = window(1000, () => makeEvent("turn_start"));
    const promise = sendEventBatches(ws, "s1", stored, (_w, m) => {
      sent.push(m);
      if (sent.length === 2) ws.readyState = 3; // CLOSED after batch 2
    });
    await expect(promise).resolves.toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("X5: bufferedAmount pinned above the threshold pauses then resumes, delivering all batches in order", async () => {
    let polls = 0;
    const ws = {
      readyState: 1,
      OPEN: 1,
      get bufferedAmount() {
        // Above 1 MB for the first 3 reads after the first batch, then drains.
        polls += 1;
        return polls <= 3 ? 2_000_000 : 0;
      },
    } as any;
    const sent: any[] = [];
    const returned = await sendEventBatches(ws, "s1", window(600, () => makeEvent("turn_start")), (_w, m) =>
      sent.push(m),
    );
    expect(sent).toHaveLength(3);
    expect(sent.flatMap((m) => m.events.map((e: any) => e.seq))).toEqual(
      Array.from({ length: 600 }, (_, i) => i + 1),
    );
    expect(returned).toBe(600);
  });
});

describe("handleSubscribe — replayed seq contract", () => {
  it("5.1: cold subscribe over a large window replays strictly increasing, duplicate-free seqs", async () => {
    const ctx = createMockContext();
    ctx.eventStore.insertEvent("s1", makeEvent("message_start"));
    for (let i = 0; i < 800; i++) ctx.eventStore.insertEvent("s1", assistantUpdate(`t${i}`));
    ctx.eventStore.insertEvent("s1", makeEvent("message_end"));
    for (let i = 0; i < 300; i++) ctx.eventStore.insertEvent("s1", makeEvent("turn_start"));

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 100));

    const batches = replayBatches(ctx);
    const seqs = batches.flatMap((b) => b.events.map((e) => e.seq));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    // Compaction did real work: 1102 stored → far fewer replayed.
    expect(seqs.length).toBeLessThan(400);
    expect(batches.filter((b) => b.isLast)).toHaveLength(1);
  });

  it("X1 (handler): clearReplaying receives the pre-compaction max seq", async () => {
    const ctx = createMockContext();
    ctx.eventStore.insertEvent("s1", makeEvent("message_start"));
    for (let i = 0; i < 20; i++) ctx.eventStore.insertEvent("s1", assistantUpdate(`t${i}`));
    ctx.eventStore.insertEvent("s1", makeEvent("message_end"));
    for (let i = 0; i < 5; i++) ctx.eventStore.insertEvent("s1", assistantUpdate(`tail${i}`));
    const maxSeq = ctx.eventStore.getMaxSeq("s1");

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.clearReplaying).toHaveBeenCalledWith(ctx.ws, "s1", maxSeq);
  });

  it("X2: catch-up covers only events above the pre-compaction max", async () => {
    // The dropped event is the window's highest seq; the reported high-water
    // mark must still be that seq so the catch-up starts strictly above it.
    const ctx = createMockContext();
    ctx.eventStore.insertEvent("s1", makeEvent("message_start"));
    for (let i = 0; i < 225; i++) ctx.eventStore.insertEvent("s1", assistantUpdate(`t${i}`));
    ctx.eventStore.insertEvent("s1", makeEvent("message_end"));
    ctx.eventStore.insertEvent("s1", assistantUpdate("dropped-tail-228"));
    expect(ctx.eventStore.getMaxSeq("s1")).toBe(228);

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 0 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 50));

    const reported = (ctx.clearReplaying as any).mock.calls[0][2] as number;
    expect(reported).toBe(228);
    // Anything the live path buffers next (229..231) is strictly above it, so
    // no already-covered event can be re-sent as catch-up.
    const delivered = replayBatches(ctx).flatMap((b) => b.events.map((e) => e.seq));
    expect(Math.max(...delivered)).toBeLessThanOrEqual(reported);
  });
});

describe("handleSubscribe — unchanged paths", () => {
  it("X6: warm delta subscribe (lastSeq > 0) still marks replaying exactly once", async () => {
    const ctx = createMockContext();
    for (let i = 0; i < 10; i++) ctx.eventStore.insertEvent("s1", makeEvent("tool_execution_start"));

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 4 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.markReplaying).toHaveBeenCalledTimes(1);
    const seqs = replayBatches(ctx).flatMap((b) => b.events.map((e) => e.seq));
    expect(seqs).toEqual([5, 6, 7, 8, 9, 10]);
    expect(ctx.clearReplaying).toHaveBeenCalledWith(ctx.ws, "s1", 10);
  });

  it("X7: empty window → markReplaying NOT called", async () => {
    const ctx = createMockContext();
    for (let i = 0; i < 3; i++) ctx.eventStore.insertEvent("s1", makeEvent("turn_start"));

    handleSubscribe({ type: "subscribe", sessionId: "s1", lastSeq: 3 }, new Set(), ctx);
    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.markReplaying).not.toHaveBeenCalled();
    expect(ctx.clearReplaying).not.toHaveBeenCalled();
  });
});
