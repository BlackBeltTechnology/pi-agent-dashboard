import { describe, expect, it } from "vitest";
import { connectWithReconnect, type MinimalSocket, type ReconnectOptions, type ReconnectStatus } from "../socket.js";

// Ported from InvoiceBot `src/__tests__/chat-session-reconnect.test.ts` (the
// controller half; the chat fold stays product code), extended per design D7
// (change: extract-standalone-app-kit).

class FakeSocket implements MinimalSocket {
  sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {}
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  serverClose(): void {
    this.onclose?.();
  }
  serverError(): void {
    this.onerror?.();
  }
}

function makeTimers() {
  const queue: Array<{ id: number; fn: () => void; ms: number }> = [];
  let seq = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      queue.push({ id, fn, ms });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (h: ReturnType<typeof setTimeout>) => {
      const i = queue.findIndex((q) => q.id === (h as unknown as number));
      if (i >= 0) queue.splice(i, 1);
    },
    flush: () => {
      for (const q of queue.splice(0)) q.fn();
    },
    pending: () => queue.length,
    delays: () => queue.map((q) => q.ms),
  };
}

function harness(overrides: Partial<ReconnectOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const statuses: ReconnectStatus[] = [];
  const timers = makeTimers();
  const conn = connectWithReconnect({
    url: "/ws",
    random: () => 0,
    createSocket: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onStatus: (s) => statuses.push(s),
    onOpen: (send) => send(JSON.stringify({ type: "subscribe", sessionId: "S1", lastSeq: 0 })),
    onMessage: () => {},
    ...overrides,
  });
  return { conn, sockets, statuses, timers };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe("connectWithReconnect (ported cases — F9)", () => {
  it("subscribes on open and reports connecting → connected", () => {
    const { sockets, statuses } = harness();
    expect(sockets.length).toBe(1);
    expect(statuses[0]).toBe("connecting");
    sockets[0].open();
    expect(statuses).toContain("connected");
    expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ type: "subscribe", sessionId: "S1", lastSeq: 0 });
  });

  it("reconnects and re-subscribes after an unexpected close", () => {
    const { sockets, statuses, timers } = harness();
    sockets[0].open();
    sockets[0].serverClose();
    expect(statuses).toContain("reconnecting");
    expect(timers.pending()).toBe(1);
    timers.flush();
    expect(sockets.length).toBe(2);
    sockets[1].open();
    expect(JSON.parse(sockets[1].sent[0])).toMatchObject({ type: "subscribe" });
    expect(statuses[statuses.length - 1]).toBe("connected");
  });

  it("also reconnects on an unexpected socket error", () => {
    const { sockets, timers } = harness();
    sockets[0].open();
    sockets[0].serverError();
    expect(timers.pending()).toBe(1);
    timers.flush();
    expect(sockets.length).toBe(2);
  });

  it("caps retries after a clean open and surfaces a terminal 'disconnected'", () => {
    const { sockets, statuses, timers } = harness({ maxRetries: 2 });
    sockets[0].open();
    sockets[0].serverClose();
    timers.flush();
    sockets[1].serverClose();
    timers.flush();
    sockets[2].serverClose();
    expect(statuses[statuses.length - 1]).toBe("disconnected");
    expect(timers.pending()).toBe(0);
    expect(sockets.length).toBe(3);
  });

  it("accepts the full InvoiceBot option shape and backs off exponentially, capped", () => {
    const opts: ReconnectOptions = {
      url: "/ws",
      resolveUrl: () => "ws://h/ws",
      createSocket: (u) => new FakeSocket(u),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
      random: () => 0,
      baseDelayMs: 100,
      maxDelayMs: 300,
      jitterRatio: 0,
      maxRetries: 5,
      onStatus: () => {},
      onOpen: () => {},
      onMessage: () => {},
    };
    expect(opts.url).toBe("/ws");
    const { sockets, timers } = harness({ baseDelayMs: 100, maxDelayMs: 300, jitterRatio: 0.5, random: () => 1, maxRetries: 5 });
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      sockets[i].serverClose();
      seen.push(...timers.delays());
      timers.flush();
    }
    // 100·2^n capped at 300, plus random()·exp·jitterRatio = +50%.
    expect(seen).toEqual([150, 300, 450]);
  });
});

describe("connectWithReconnect — design D7", () => {
  it("F5: resolves a fresh URL (ticket) before every attempt", () => {
    const tickets = ["k1", "k2", "k3"];
    let calls = 0;
    const { sockets, timers } = harness({ resolveUrl: () => `ws://h/ws?ticket=${tickets[calls++]}` });
    sockets[0].open();
    sockets[0].serverClose();
    timers.flush();
    sockets[1].open();
    sockets[1].serverClose();
    timers.flush();
    expect(calls).toBe(3);
    expect(sockets.map((s) => s.url)).toEqual(["ws://h/ws?ticket=k1", "ws://h/ws?ticket=k2", "ws://h/ws?ticket=k3"]);
  });

  it("F5: an async resolver also runs per attempt", async () => {
    let calls = 0;
    const { sockets, timers } = harness({ resolveUrl: async () => `ws://h/ws?ticket=k${++calls}` });
    await flushMicrotasks();
    sockets[0].serverClose();
    timers.flush();
    await flushMicrotasks();
    expect(sockets.map((s) => s.url)).toEqual(["ws://h/ws?ticket=k1", "ws://h/ws?ticket=k2"]);
  });

  it.each([
    [0, 1],
    [1, 2],
    [3, 4],
  ])("F6: maxRetries=%i with every attempt failing → %i attempts, then disconnected", (maxRetries, attempts) => {
    const { sockets, statuses, timers } = harness({ maxRetries });
    for (let i = 0; i < 10 && sockets[i]; i++) {
      sockets[i].serverClose();
      timers.flush();
    }
    expect(sockets.length).toBe(attempts);
    expect(statuses[statuses.length - 1]).toBe("disconnected");
    expect(timers.pending()).toBe(0);
  });

  it("F7: close() never reconnects, even on a late close event", () => {
    const { conn, sockets, statuses, timers } = harness();
    sockets[0].open();
    conn.close();
    expect(sockets[0].closed).toBe(true);
    sockets[0].serverClose();
    expect(timers.pending()).toBe(0);
    expect(sockets.length).toBe(1);
    expect(statuses[statuses.length - 1]).toBe("disconnected");
    expect(statuses.slice(statuses.indexOf("connected"))).not.toContain("reconnecting");
  });

  it("F7: close() during a pending retry cancels the timer", () => {
    const { conn, sockets, timers } = harness();
    sockets[0].serverClose();
    expect(timers.pending()).toBe(1);
    conn.close();
    expect(timers.pending()).toBe(0);
  });

  it("F8: error then close schedules exactly one retry", () => {
    const { sockets, timers } = harness();
    sockets[0].open();
    sockets[0].serverError();
    sockets[0].serverClose();
    expect(timers.pending()).toBe(1);
  });

  it("X4: a resolver returning null → disconnected immediately, no socket, no retry timer", () => {
    const { sockets, statuses, timers } = harness({ resolveUrl: () => null });
    expect(sockets.length).toBe(0);
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(timers.pending()).toBe(0);
  });

  it("X4: a rejecting resolver → disconnected, no socket, no retry timer", async () => {
    const { sockets, statuses, timers } = harness({ resolveUrl: () => Promise.reject(new Error("mint failed")) });
    await flushMicrotasks();
    expect(sockets.length).toBe(0);
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(timers.pending()).toBe(0);
  });

  it("X4: a throwing resolver → disconnected, no retry timer", () => {
    const { statuses, timers } = harness({
      resolveUrl: () => {
        throw new Error("boom");
      },
    });
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(timers.pending()).toBe(0);
  });

  it("X4: null on a reconnect attempt ends the loop", () => {
    let n = 0;
    const { sockets, statuses, timers } = harness({ resolveUrl: () => (n++ === 0 ? "ws://h/ws?ticket=k1" : null) });
    sockets[0].open();
    sockets[0].serverClose();
    timers.flush();
    expect(sockets.length).toBe(1);
    expect(statuses[statuses.length - 1]).toBe("disconnected");
    expect(timers.pending()).toBe(0);
  });
});
