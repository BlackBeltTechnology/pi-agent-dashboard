/**
 * Serialized inbound message pump.
 *
 * Covers every automated row of
 * `openspec/changes/serialize-bridge-message-pump/test-plan.md`
 * (E1-E11, P1, X1-X7). Harness glue copied from `connection.test.ts`.
 *
 * See change: serialize-bridge-message-pump.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager, type ConnectionManagerOptions } from "../connection.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sentMessages.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** Drain pending microtasks so the async pump can make progress. */
async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** ConnectionManager wired to the mock socket, already open. */
function connect(opts: Partial<ConnectionManagerOptions> = {}) {
  const cm = new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: MockWebSocket as any,
    watchdogTimeout: 0,
    ...opts,
  });
  cm.connect();
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  ws.simulateOpen();
  return { cm, ws };
}

describe("inbound message pump — serialization", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // E1 — a state-mutating message completes before a dependent one starts.
  it("does not enter send_prompt until the set_model handler has returned", async () => {
    const entered: string[] = [];
    const returned: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.type);
        if (data.type === "set_model") await gate.promise;
        returned.push(data.type);
      },
    });

    ws.simulateMessage({ type: "set_model" });
    ws.simulateMessage({ type: "send_prompt" });
    await flush();

    // send_prompt must NOT have started while set_model is parked
    expect(entered).toEqual(["set_model"]);

    gate.resolve();
    await flush();

    expect(returned).toEqual(["set_model", "send_prompt"]);
    expect(entered).toEqual(["set_model", "send_prompt"]);
    cm.disconnect();
  });

  // E2 — ordering holds across a burst of mixed serialized types.
  it("completes a 20-message mixed burst in delivery order, dropping none", async () => {
    const completed: string[] = [];
    const types = ["set_model", "send_prompt", "set_thinking_level", "rename_session"];
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        await Promise.resolve(); // yield once
        completed.push(data.id);
      },
    });

    const delivered: string[] = [];
    for (let i = 0; i < 20; i++) {
      const id = `${types[i % types.length]}-${i}`;
      delivered.push(id);
      ws.simulateMessage({ type: types[i % types.length], id });
    }
    await flush(60);

    expect(completed).toEqual(delivered);
    expect(completed).toHaveLength(20);
    cm.disconnect();
  });

  // E3 — a cancellation is never reordered ahead of its target.
  it("dispatches abort only after the preceding send_prompt handler returns", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.type);
        if (data.type === "send_prompt") await gate.promise;
      },
    });

    ws.simulateMessage({ type: "send_prompt" });
    ws.simulateMessage({ type: "abort" });
    await flush();

    expect(entered).toEqual(["send_prompt"]); // abort has NOT jumped ahead

    gate.resolve();
    await flush();

    expect(entered).toEqual(["send_prompt", "abort"]);
    cm.disconnect();
  });
});

describe("inbound message pump — immediate lane", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Park the pump on a slow handler, then deliver `msg` and flush. */
  async function withParkedPump(msg: unknown, extra?: (cm: ConnectionManager) => void) {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.type);
        if (data.type === "park") await gate.promise;
        extra?.(cm);
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage(msg);
    await flush();
    return { entered, gate, cm, ws };
  }

  // E4 — the reply lane is never queued behind the handler awaiting it.
  it("dispatches prompt_response while the serialized lane is blocked", async () => {
    const { entered, gate, cm } = await withParkedPump({ type: "prompt_response" });
    expect(entered).toEqual(["park", "prompt_response"]);
    gate.resolve();
    await flush();
    cm.disconnect();
  });

  // E5 — the restart quiesce signal takes effect immediately.
  it("applies the server_restarting quiesce window while the lane is blocked", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.type);
        if (data.type === "park") await gate.promise;
        if (data.type === "server_restarting") cm.pauseAutoStart(data.quiesceMs);
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();

    expect(cm.shouldSuppressAutoStart()).toBe(false);
    ws.simulateMessage({ type: "server_restarting", quiesceMs: 5000 });
    await flush();

    // Applied BEFORE the parked handler resolves
    expect(entered).toEqual(["park", "server_restarting"]);
    expect(cm.shouldSuppressAutoStart()).toBe(true);

    gate.resolve();
    await flush();
    cm.disconnect();
  });

  // E6 — the only working child-kill path stays reachable.
  it("dispatches kill_process while the serialized lane is blocked", async () => {
    const { entered, gate, cm } = await withParkedPump({ type: "kill_process", pgid: 4242 });
    expect(entered).toEqual(["park", "kill_process"]);
    gate.resolve();
    await flush();
    cm.disconnect();
  });

  // E7 — allow-list defaults to the safe direction.
  it("serializes an unrecognized message type", async () => {
    const { entered, gate, cm } = await withParkedPump({ type: "some_future_message" });
    expect(entered).toEqual(["park"]); // NOT dispatched yet
    gate.resolve();
    await flush();
    expect(entered).toEqual(["park", "some_future_message"]);
    cm.disconnect();
  });

  // E8 — the immediate lane is exactly the three named types.
  it("serializes abort, shutdown and flow_control", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.type);
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();

    ws.simulateMessage({ type: "abort" });
    ws.simulateMessage({ type: "shutdown" });
    ws.simulateMessage({ type: "flow_control", action: "abort" });
    await flush();

    expect(entered).toEqual(["park"]);

    gate.resolve();
    await flush();

    expect(entered).toEqual(["park", "abort", "shutdown", "flow_control"]);
    cm.disconnect();
  });
});

describe("inbound message pump — bounded back-pressure", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Park the pump, then fill the queue to `n` and attempt `overflow` more. */
  async function fill(n: number, overflow: number) {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      maxInboundQueue: 4,
      onMessage: async (data: any) => {
        entered.push(data.id ?? data.type);
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park", id: "park" });
    await flush();
    for (let i = 0; i < n; i++) ws.simulateMessage({ type: "send_prompt", id: `q${i}` });
    for (let i = 0; i < overflow; i++) ws.simulateMessage({ type: "send_prompt", id: `over${i}` });
    return { entered, gate, cm, ws };
  }

  // E9 — BVA around the inbound cap.
  it("accepts up to the cap and refuses the newest beyond it", async () => {
    const { entered, gate, cm } = await fill(4, 1);
    expect(cm.getDroppedInboundCount()).toBe(1);

    gate.resolve();
    await flush(30);

    expect(entered).toEqual(["park", "q0", "q1", "q2", "q3"]);
    expect(entered).not.toContain("over0");
    cm.disconnect();
  });

  // E10 — drop-newest never invalidates the accepted prefix.
  it("preserves the accepted prefix in wire order when refusing", async () => {
    const { entered, gate, cm } = await fill(4, 3);
    expect(cm.getDroppedInboundCount()).toBe(3);

    gate.resolve();
    await flush(30);

    expect(entered).toEqual(["park", "q0", "q1", "q2", "q3"]);
    cm.disconnect();
  });

  // X7 — the warn is rate-limited but the counter is not.
  it("rate-limits the overflow warning to one per 5s window while counting every refusal", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = deferred();
    const { cm, ws } = connect({
      maxInboundQueue: 1,
      onMessage: async (data: any) => {
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "fills-the-queue" });
    await flush();

    ws.simulateMessage({ type: "send_prompt", id: "t0" }); // t=0 → warn
    vi.advanceTimersByTime(1000);
    ws.simulateMessage({ type: "send_prompt", id: "t1s" }); // inside window → no warn
    vi.advanceTimersByTime(5000);
    ws.simulateMessage({ type: "send_prompt", id: "t6s" }); // outside window → warn
    await flush();

    expect(cm.getDroppedInboundCount()).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);

    gate.resolve();
    await flush();
    cm.disconnect();
  });

  // X6 — overflow refusals and disconnect discards are separate signals.
  it("counts overflow refusals separately from disconnect discards", async () => {
    const gate = deferred();
    const { cm, ws } = connect({
      maxInboundQueue: 1,
      onMessage: async (data: any) => {
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "queued" }); // fills queue
    ws.simulateMessage({ type: "send_prompt", id: "refused" }); // overflow
    await flush();

    expect(cm.getDroppedInboundCount()).toBe(1);
    expect(cm.getDiscardedInboundCount()).toBe(0);

    ws.simulateClose(); // discards the 1 queued message
    await flush();

    expect(cm.getDroppedInboundCount()).toBe(1);
    expect(cm.getDiscardedInboundCount()).toBe(1);

    gate.resolve();
    await flush();
    cm.disconnect();
  });
});

describe("inbound message pump — failure isolation", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // X1 — a rejecting handler does not stall the pump.
  it("continues in order after a handler rejects", async () => {
    const entered: string[] = [];
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.id);
        if (data.id === "m1") throw new Error("boom");
      },
    });

    ws.simulateMessage({ type: "send_prompt", id: "m1" });
    ws.simulateMessage({ type: "send_prompt", id: "m2" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "m3" });
    await flush();

    expect(entered).toEqual(["m1", "m2", "m3"]);
    cm.disconnect();
  });

  // X2 — a synchronously throwing handler does not stall the pump.
  it("continues in order after a handler throws synchronously", async () => {
    const entered: string[] = [];
    const { cm, ws } = connect({
      onMessage: (data: any) => {
        entered.push(data.id);
        if (data.id === "m1") throw new Error("sync boom");
      },
    });

    ws.simulateMessage({ type: "send_prompt", id: "m1" });
    ws.simulateMessage({ type: "send_prompt", id: "m2" });
    await flush();

    expect(entered).toEqual(["m1", "m2"]);
    cm.disconnect();
  });
});

describe("inbound message pump — connection lifecycle", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // X3 — a dead socket's backlog never reaches the replacement connection.
  it("discards a queued backlog on disconnect and serves the new connection", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.id);
        if (data.id === "park") await gate.promise;
      },
    });

    ws.simulateMessage({ type: "send_prompt", id: "park" });
    await flush();
    for (const id of ["stale1", "stale2", "stale3"]) {
      ws.simulateMessage({ type: "send_prompt", id });
    }
    await flush();

    ws.simulateClose();
    await flush();
    expect(cm.getDiscardedInboundCount()).toBe(3);

    vi.advanceTimersByTime(1000);
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws2.simulateOpen();
    ws2.simulateMessage({ type: "send_prompt", id: "fresh" });
    await flush();

    expect(entered).toContain("fresh");
    expect(entered).not.toContain("stale1");

    gate.resolve();
    await flush();
    expect(entered).not.toContain("stale1");
    cm.disconnect();
  });

  // X4 — the in-flight handler must not delay the replacement connection.
  it("serves the new connection without waiting for an in-flight handler, and retires the superseded loop", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.id);
        if (data.id === "park") await gate.promise;
      },
    });

    ws.simulateMessage({ type: "send_prompt", id: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "stale" });
    await flush();

    ws.simulateClose(); // disconnect WHILE the handler is still parked
    vi.advanceTimersByTime(1000);
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws2.simulateOpen();
    ws2.simulateMessage({ type: "send_prompt", id: "fresh" });
    await flush();

    // dispatched WITHOUT the parked handler having resolved
    expect(entered).toEqual(["park", "fresh"]);

    gate.resolve();
    await flush(30);

    // the superseded loop dispatches nothing further
    expect(entered).toEqual(["park", "fresh"]);
    cm.disconnect();
  });

  // X5 — the deliberate teardown path clears too.
  it("clears and counts the queue on a deliberate disconnect", async () => {
    const entered: string[] = [];
    const gate = deferred();
    const { cm, ws } = connect({
      onMessage: async (data: any) => {
        entered.push(data.id);
        if (data.id === "park") await gate.promise;
      },
    });

    ws.simulateMessage({ type: "send_prompt", id: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "stale1" });
    ws.simulateMessage({ type: "send_prompt", id: "stale2" });
    await flush();

    cm.disconnect(); // deliberate teardown, NOT handleDisconnect
    await flush();

    expect(cm.getDiscardedInboundCount()).toBe(2);

    gate.resolve();
    await flush();
    expect(entered).toEqual(["park"]);
  });

  // E11 — a message queued across a session switch is discarded by the guard.
  it("discards a queued message whose session was replaced before dispatch", async () => {
    const applied: string[] = [];
    const gate = deferred();
    let currentSession = "A";
    const { cm, ws } = connect({
      // Mirrors the bridge's dispatch-time session guard (command-handler.ts:428).
      onMessage: async (data: any) => {
        if (data.type === "park") {
          await gate.promise;
          return;
        }
        if (data.sessionId !== undefined && data.sessionId !== currentSession) return;
        applied.push(data.id);
      },
    });

    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "for-A", sessionId: "A" });
    await flush();

    currentSession = "B"; // session replaced while the message sits in the queue

    gate.resolve();
    await flush(30);

    expect(applied).toEqual([]);
    cm.disconnect();
  });
});

describe("inbound message pump — hot-path overhead", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  // P1 — shape guard against an accidental O(n^2) queue, NOT a latency SLA.
  it("drains a 1000-message burst well within the budget", async () => {
    const { cm, ws } = connect({
      maxInboundQueue: 2000,
      onMessage: () => {
        /* no-op */
      },
    });

    const started = Date.now();
    for (let i = 0; i < 1000; i++) ws.simulateMessage({ type: "send_prompt", id: i });
    await flush(2000);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    cm.disconnect();
  });
});
