/**
 * subscriptions/listen delivery, isolation and teardown.
 *
 * Covers S1 (delivery), S2 (isolation), S4 (clean teardown), S5 (abort
 * teardown), S6 (churn leaves no leak), S9 (revocation terminates a live
 * stream) and X12 (bounded slow consumer).
 */
import { describe, expect, it, vi } from "vitest";
import {
  type EventSource,
  MAX_BUFFERED_EVENTS,
  type StreamSink,
  SubscriptionRegistry,
} from "../streaming.js";
import type { McpCaller } from "../tokens.js";

const caller: McpCaller = { kind: "device", deviceId: "d1" };

/**
 * A source that mirrors `ctx.onEvent`: every listener sees EVERY session's
 * events. Tracking `listenerCount` is what makes the leak assertions real.
 */
function makeSource() {
  const handlers = new Set<(sessionId: string, payload: unknown) => void>();
  const source: EventSource = {
    onEvent(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
  return {
    source,
    get listenerCount() {
      return handlers.size;
    },
    emit(sessionId: string, payload: unknown) {
      for (const h of [...handlers]) h(sessionId, payload);
    },
  };
}

function makeSink(opts: { acceptWrites?: boolean } = {}) {
  const chunks: string[] = [];
  let ended = false;
  const sink: StreamSink = {
    write(chunk) {
      chunks.push(chunk);
      return opts.acceptWrites !== false;
    },
    end() {
      ended = true;
    },
  };
  return {
    sink,
    chunks,
    get ended() {
      return ended;
    },
    events: () => chunks.map((c) => JSON.parse(c)),
  };
}

describe("S1/S2 — delivery and isolation", () => {
  it("S1 — an event from a subscribed session is delivered", () => {
    const src = makeSource();
    const out = makeSink();
    new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);

    src.emit("A", { type: "message", text: "hello" });

    expect(out.events()).toEqual([{ sessionId: "A", payload: { type: "message", text: "hello" } }]);
  });

  it("S2 — an unsubscribed session's event does NOT leak onto the stream", () => {
    const src = makeSource();
    const out = makeSink();
    new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);

    src.emit("B", { secret: "should not appear" });

    expect(out.chunks).toHaveLength(0);
  });

  it("S2 — with two subscriptions live, each receives only its own session", () => {
    const src = makeSource();
    const a = makeSink();
    const b = makeSink();
    const reg = new SubscriptionRegistry();
    reg.open(src.source, ["A"], a.sink, caller);
    reg.open(src.source, ["B"], b.sink, caller);

    src.emit("A", 1);
    src.emit("B", 2);

    expect(a.events()).toEqual([{ sessionId: "A", payload: 1 }]);
    expect(b.events()).toEqual([{ sessionId: "B", payload: 2 }]);
  });

  it("delivers every named session for a multi-session subscription", () => {
    const src = makeSource();
    const out = makeSink();
    new SubscriptionRegistry().open(src.source, ["A", "B"], out.sink, caller);

    src.emit("A", 1);
    src.emit("C", 99);
    src.emit("B", 2);

    expect(out.events()).toEqual([
      { sessionId: "A", payload: 1 },
      { sessionId: "B", payload: 2 },
    ]);
  });
});

describe("S4/S5 — teardown releases the underlying subscription", () => {
  it("S4 — a clean close returns the listener count to baseline", () => {
    const src = makeSource();
    const out = makeSink();
    const reg = new SubscriptionRegistry();
    expect(src.listenerCount).toBe(0);

    const sub = reg.open(src.source, ["A"], out.sink, caller);
    expect(src.listenerCount).toBe(1);

    sub.close();

    expect(src.listenerCount).toBe(0);
    expect(reg.size).toBe(0);
    expect(out.ended).toBe(true);
  });

  it("S5 — an aborted transport still releases the subscription", () => {
    const src = makeSource();
    // A sink whose end() throws models a transport already torn down under us.
    const sink: StreamSink = {
      write: () => true,
      end: () => {
        throw new Error("socket already destroyed");
      },
    };
    const reg = new SubscriptionRegistry();
    const sub = reg.open(src.source, ["A"], sink, caller);

    expect(() => sub.close()).not.toThrow();

    expect(src.listenerCount).toBe(0);
    expect(reg.size).toBe(0);
  });

  it("close is idempotent — a double close does not double-release", () => {
    const src = makeSource();
    const out = makeSink();
    const reg = new SubscriptionRegistry();
    const sub = reg.open(src.source, ["A"], out.sink, caller);

    sub.close();
    sub.close();

    expect(src.listenerCount).toBe(0);
    expect(reg.size).toBe(0);
  });

  it("a closed subscription delivers nothing further", () => {
    const src = makeSource();
    const out = makeSink();
    const sub = new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);
    sub.close();

    src.emit("A", { late: true });

    expect(out.chunks).toHaveLength(0);
  });

  it("X8 — closeAll releases every live subscription", () => {
    const src = makeSource();
    const reg = new SubscriptionRegistry();
    reg.open(src.source, ["A"], makeSink().sink, caller);
    reg.open(src.source, ["B"], makeSink().sink, caller);
    expect(src.listenerCount).toBe(2);

    reg.closeAll();

    expect(src.listenerCount).toBe(0);
    expect(reg.size).toBe(0);
  });
});

describe("S6 — repeated churn does not leak", () => {
  it("1000 open/abandon cycles return the listener count to baseline", () => {
    const src = makeSource();
    const reg = new SubscriptionRegistry();
    const baseline = src.listenerCount;

    for (let i = 0; i < 1000; i += 1) {
      const sub = reg.open(src.source, [`session-${i}`], makeSink().sink, caller);
      sub.close();
    }

    expect(src.listenerCount).toBe(baseline);
    expect(reg.size).toBe(0);
  });

  it("churn does not accumulate registry entries even when events fly", () => {
    const src = makeSource();
    const reg = new SubscriptionRegistry();

    for (let i = 0; i < 500; i += 1) {
      const sub = reg.open(src.source, ["A"], makeSink().sink, caller);
      src.emit("A", i);
      sub.close();
    }

    expect(reg.size).toBe(0);
    expect(src.listenerCount).toBe(0);
  });
});

describe("S9 — revocation affects a live stream", () => {
  it("terminates the stream when the credential is revoked mid-flight", () => {
    const src = makeSource();
    const out = makeSink();
    let authorised = true;
    const sub = new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller, {
      isStillAuthorised: () => authorised,
    });

    src.emit("A", { first: true });
    expect(out.events()).toHaveLength(1);

    authorised = false;
    src.emit("A", { second: true });

    expect(sub.isClosed).toBe(true);
    expect(out.ended).toBe(true);
    // The client is TOLD, rather than left with a stream that silently drains.
    expect(out.events().at(-1)).toMatchObject({ error: "stream terminated" });
    expect(src.listenerCount).toBe(0);
  });

  it("does not deliver the event that triggered the revocation check", () => {
    const src = makeSource();
    const out = makeSink();
    new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller, {
      isStillAuthorised: () => false,
    });

    src.emit("A", { sensitive: "must not be delivered" });

    expect(JSON.stringify(out.chunks)).not.toContain("sensitive");
  });
});

describe("X12 — a slow consumer is bounded", () => {
  it("disconnects rather than buffering without bound", () => {
    const src = makeSource();
    // acceptWrites:false models a consumer that has stopped reading, so every
    // write stays outstanding.
    const out = makeSink({ acceptWrites: false });
    const sub = new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);

    for (let i = 0; i < MAX_BUFFERED_EVENTS + 100; i += 1) src.emit("A", i);

    expect(sub.isClosed).toBe(true);
    // Bounded: the buffer cap plus the single termination frame.
    expect(out.chunks.length).toBeLessThanOrEqual(MAX_BUFFERED_EVENTS + 1);
    expect(src.listenerCount).toBe(0);
  });

  it("states the reason so the drop policy is not silent", () => {
    const src = makeSource();
    const out = makeSink({ acceptWrites: false });
    new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);

    for (let i = 0; i < MAX_BUFFERED_EVENTS + 10; i += 1) src.emit("A", i);

    expect(out.events().at(-1)).toMatchObject({
      error: "stream terminated",
      reason: "subscriber too slow",
    });
  });

  it("a keeping-up consumer is never disconnected", () => {
    const src = makeSource();
    const out = makeSink({ acceptWrites: true });
    const sub = new SubscriptionRegistry().open(src.source, ["A"], out.sink, caller);

    for (let i = 0; i < MAX_BUFFERED_EVENTS * 3; i += 1) src.emit("A", i);

    expect(sub.isClosed).toBe(false);
    expect(out.chunks).toHaveLength(MAX_BUFFERED_EVENTS * 3);
  });
});
