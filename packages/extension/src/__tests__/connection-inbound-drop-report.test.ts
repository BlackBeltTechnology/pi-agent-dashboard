/**
 * Bridge-side reporting of inbound messages the bridge threw away.
 *
 * The drop sites' only prior record was a `console.error` written to
 * `/dev/null` whenever `keeperLog.capturePiOutput` is false (the default).
 *
 * Harness glue copied from `connection-inbound-pump.test.ts`.
 * See change: fix-spawn-correlation-ttl-coupling (test-plan E33, X5, X6, D6).
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
  /** Set to make `send` throw, simulating a socket that died mid-call. */
  throwOnSend = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    if (this.throwOnSend) throw new Error("socket closed");
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
  simulateMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

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

function connect(opts: Partial<ConnectionManagerOptions> = {}) {
  const cm = new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: MockWebSocket as any,
    watchdogTimeout: 0,
    getSessionId: () => "S_self",
    ...opts,
  });
  cm.connect();
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
  ws.simulateOpen();
  return { cm, ws };
}

function reports(ws: MockWebSocket): any[] {
  return ws.sentMessages
    .map((m) => JSON.parse(m))
    .filter((m) => m.type === "inbound_drop_report");
}

describe("inbound drop reporting", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reports an overflow drop, routed by the bridge's OWN session id", async () => {
    const gate = deferred();
    const { cm, ws } = connect({
      maxInboundQueue: 1,
      onMessage: async (data: any) => {
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "q0" });
    ws.simulateMessage({ type: "send_prompt", id: "over" });

    const sent = reports(ws);
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionId).toBe("S_self");
    expect(sent[0].dropClass).toBe("queue_overflow");
    expect(sent[0].messageType).toBe("send_prompt");
    gate.resolve();
    await flush(30);
    cm.disconnect();
  });

  // E33 — 100 drops in one window yield at most 10 reports, and the suppression
  // count rides the next report the bound permits.
  it("bounds reports at 10 per session per 60s window and conveys suppression", async () => {
    const gate = deferred();
    const { cm, ws } = connect({
      maxInboundQueue: 1,
      onMessage: async (data: any) => {
        if (data.type === "park") await gate.promise;
      },
    });
    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "q0" });
    for (let i = 0; i < 100; i++) ws.simulateMessage({ type: "send_prompt", id: `over${i}` });

    expect(reports(ws)).toHaveLength(10);
    expect(reports(ws).every((r) => r.suppressed === undefined)).toBe(true);

    // Next window: the first report carries what the bound elided.
    vi.advanceTimersByTime(60_001);
    ws.simulateMessage({ type: "send_prompt", id: "after" });
    const after = reports(ws);
    expect(after).toHaveLength(11);
    expect(after[10].suppressed).toBe(90);

    gate.resolve();
    await flush(30);
    cm.disconnect();
  });

  // X5 — socket down at drop time: nothing sent, nothing queued for reconnect.
  it("sends nothing and buffers nothing when the socket is down", () => {
    const { cm, ws } = connect();
    ws.readyState = 3;
    cm.reportInboundDrop({ dropClass: "session_mismatch", droppedSessionId: "S_other" });
    expect(reports(ws)).toHaveLength(0);

    // Reconnecting must not flush a report that describes a past moment.
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws2.readyState = 1;
    ws2.simulateOpen();
    expect(reports(ws2)).toHaveLength(0);
    cm.disconnect();
  });

  // X6 — the socket closes between the liveness check and the send.
  it("does not buffer a report whose send throws mid-call", () => {
    const { cm, ws } = connect();
    ws.throwOnSend = true;
    expect(() =>
      cm.reportInboundDrop({ dropClass: "session_mismatch", droppedSessionId: "S_other" }),
    ).not.toThrow();
    ws.throwOnSend = false;
    // Nothing was retained to be flushed later.
    cm.send({ type: "heartbeat" });
    expect(reports(ws)).toHaveLength(0);
    cm.disconnect();
  });

  it("skips reporting before the bridge knows its own session id", () => {
    const { cm, ws } = connect({ getSessionId: () => undefined });
    cm.reportInboundDrop({ dropClass: "session_mismatch", droppedSessionId: "S_other" });
    expect(reports(ws)).toHaveLength(0);
    cm.disconnect();
  });

  it("carries the dropped session id as payload, never as the routing field", () => {
    const { cm, ws } = connect();
    cm.reportInboundDrop({
      dropClass: "session_mismatch",
      messageType: "send_prompt",
      droppedSessionId: "S_other",
    });
    const [report] = reports(ws);
    expect(report.sessionId).toBe("S_self");
    expect(report.droppedSessionId).toBe("S_other");
    cm.disconnect();
  });
});

/**
 * P2 — reporting sits on the inbound overflow path. 10 000 messages
 * overflowing the queue must stay within 10 % of a no-report baseline.
 * See change: fix-spawn-correlation-ttl-coupling (test-plan P2).
 */
describe("inbound drop reporting — hot-path overhead", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Flood `n` messages past a 1-deep queue, returning elapsed ms. */
  function flood(n: number, getSessionId: () => string | undefined): number {
    const { cm, ws } = connect({
      maxInboundQueue: 1,
      getSessionId,
      onMessage: async () => new Promise<void>(() => {}), // park forever
    });
    ws.simulateMessage({ type: "park" });
    ws.simulateMessage({ type: "send_prompt", id: "fill" });
    const started = performance.now();
    for (let i = 0; i < n; i++) ws.simulateMessage({ type: "send_prompt", id: i });
    const elapsed = performance.now() - started;
    cm.disconnect();
    return elapsed;
  }

  it("adds under 10 % to inbound dispatch versus a no-report baseline", () => {
    // Warm both paths so the first-run JIT cost lands outside the measurement.
    flood(2_000, () => undefined);
    flood(2_000, () => "S_self");

    const baseline = flood(10_000, () => undefined);
    const withReports = flood(10_000, () => "S_self");

    // The per-window bound caps reporting at 10 sends; the rest is one clock
    // read and a counter bump.
    expect(withReports).toBeLessThan(Math.max(baseline * 1.1, baseline + 5));
  });
});
