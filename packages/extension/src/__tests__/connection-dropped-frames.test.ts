/**
 * Task 3.4 (bridge side) for change: fix-stuck-tool-card-on-dropped-event.
 *
 * The bridge buffers outgoing messages while the WS is not OPEN in a bounded
 * buffer; on overflow `bufferMessage` evicts the oldest NON-CONTROL frame
 * (control frames — see `PINNED_FRAME_TYPES` — are kept, capped at 256). This
 * suite proves the eviction is COUNTED (`getDroppedBufferedCount`) and
 * rate-limited-LOGGED with `hop:"bridge→server"` + per-type drop counts, that
 * retained frames flush in send order, and that eviction is O(1) and never
 * parses. See change: fix-session-bridge-registration (D2, #1127; test-plan
 * E8–E17, P1–P3, X6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  public url: string;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  sent: string[] = [];
  failSend = false;
  send(d: string) {
    if (this.failSend) throw new Error("socket died");
    this.sent.push(d);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const CONTROL_TYPES = [
  "session_register",
  "session_unregister",
  "replay_complete",
  "commands_list",
  "models_list",
  "providers_list",
] as const;
const isControl = (type: unknown) => (CONTROL_TYPES as readonly unknown[]).includes(type);

const cms: ConnectionManager[] = [];
/** Connect (the socket stays CONNECTING, so everything buffers) and return the manager + its mock socket. */
const mk = (opts: Record<string, unknown> = {}) => {
  const cm = new ConnectionManager({
    url: "ws://localhost:9999",
    WebSocketImpl: MockWebSocket as any,
    ...opts,
  });
  cm.connect();
  cms.push(cm);
  return { cm, ws: MockWebSocket.instances.at(-1) as MockWebSocket };
};
/** Open the socket (flushes the buffer) and return the parsed wire frames in order. */
const flush = (ws: MockWebSocket) => {
  ws.open();
  return ws.sent.map((d) => JSON.parse(d) as { type?: string; n?: number });
};
const warnLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("dropped buffered message"));
/** Per-type count for `type` in a warning line (`droppedTypes=a:1,b:2`). */
const typeCount = (line: string, type: string) => Number(new RegExp(`[=,]${type}:(\\d+)`).exec(line)?.[1] ?? NaN);

/** Retained = every control frame (the cap is not hit) + the last `max` non-control frames. */
const expectedRetained = (sent: { type: string; n: number }[], max: number) => {
  const nonControl = sent.filter((f) => !isControl(f.type));
  const keep = new Set(nonControl.slice(Math.max(0, nonControl.length - max)).map((f) => f.n));
  return sent.filter((f) => isControl(f.type) || keep.has(f.n)).map((f) => f.n);
};
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("ConnectionManager dropped-frame instrumentation", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const cm of cms.splice(0)) cm.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts each ring-buffer eviction on overflow", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 10,
    });
    // Never connect → everything buffers. 15 sends over a cap of 10 → 5 evicted.
    for (let i = 0; i < 15; i++) {
      cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    }
    expect(cm.getDroppedBufferedCount()).toBe(5);
  });

  it("never evicts session_register on overflow", () => {
    const { cm, ws } = mk({ maxBufferSize: 3 });
    cm.send({ type: "bridge_diagnostic" });
    cm.send({ type: "session_register", sessionId: "s1" });
    for (let i = 0; i < 10; i++) cm.send({ type: "event_forward", event: { i } });
    const wire = flush(ws) as any[];
    // The register is a control frame, so it no longer counts toward `maxBufferSize`.
    expect(wire.length).toBe(4);
    expect(wire[0].type).toBe("session_register");
    expect(wire[3].event.i).toBe(9);
  });

  it("never evicts session_unregister before a session switch register", () => {
    const { cm, ws } = mk({ maxBufferSize: 3 });
    cm.send({ type: "session_unregister", sessionId: "old" });
    cm.send({ type: "session_register", sessionId: "new" });
    for (let i = 0; i < 10; i++) cm.send({ type: "event_forward", event: { i } });
    const types = flush(ws).map((f) => f.type);
    expect(types).toEqual(["session_unregister", "session_register", "event_forward", "event_forward", "event_forward"]);
  });

  it("recognises a lifecycle frame regardless of property order", () => {
    const { cm, ws } = mk({ maxBufferSize: 1 });
    cm.send({ sessionId: "s1", type: "session_register" });
    cm.send({ type: "event_forward", event: { i: 0 } });
    cm.send({ type: "event_forward", event: { i: 1 } });
    const wire = flush(ws) as any[];
    // The register survives; only the OLDEST non-control frame was evicted.
    expect(wire.map((f) => f.type)).toEqual(["session_register", "event_forward"]);
    expect(wire[1].event.i).toBe(1);
    expect(cm.getDroppedBufferedCount()).toBe(1);
  });

  it("starts at zero and stays zero under the cap", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 10,
    });
    for (let i = 0; i < 10; i++) cm.send({ type: "event_forward", event: { i } });
    expect(cm.getDroppedBufferedCount()).toBe(0);
  });

  it("logs a rate-limited warning with hop + dropped message type", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 2,
    });
    // Fill then overflow. The oldest evicted message is an `event_forward`.
    for (let i = 0; i < 6; i++) {
      cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    }
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("dropped buffered message"));
    // Rate-limited: at most one warning inside the window despite 4 evictions.
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("hop=bridge→server");
    expect(warns[0]).toContain("droppedTypes=event_forward:1");
  });
});

describe("ConnectionManager send buffer keeps control frames (fix-session-bridge-registration D2)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    for (const cm of cms.splice(0)) cm.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // test-plan #E8
  it("keeps every control frame across a replay flood, register first, evicting only old non-control", () => {
    const { cm, ws } = mk({ maxBufferSize: 10 });
    cm.send({ type: "session_register", sessionId: "s1" });
    cm.send({ type: "commands_list" });
    cm.send({ type: "models_list" });
    cm.send({ type: "providers_list" });
    for (let n = 0; n < 30; n++) cm.send({ type: "event_forward", n });
    cm.send({ type: "replay_complete" });
    for (let n = 30; n < 35; n++) cm.send({ type: "event_forward", n });

    const wire = flush(ws);
    const controls = wire.filter((f) => isControl(f.type)).map((f) => f.type);
    expect(controls).toEqual(["session_register", "commands_list", "models_list", "providers_list", "replay_complete"]);
    expect(wire[0].type).toBe("session_register");
    expect(wire.filter((f) => f.type === "event_forward").map((f) => f.n)).toEqual([
      25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    ]);
    expect(cm.getDroppedBufferedCount()).toBe(25);
  });

  // test-plan #E9
  it.each([9, 10, 11])("bounds only non-control frames: k=%i events + 4 interleaved controls", (k) => {
    const { cm, ws } = mk({ maxBufferSize: 10 });
    const controls = ["session_register", "commands_list", "models_list", "replay_complete"];
    for (let n = 0; n < k; n++) {
      cm.send({ type: "event_forward", n });
      if (n < controls.length) cm.send({ type: controls[n] });
    }
    // k=9,10 → within the bound; k=11 → exactly the OLDEST non-control evicted.
    expect(cm.getDroppedBufferedCount()).toBe(k === 11 ? 1 : 0);
    const wire = flush(ws);
    expect(wire.filter((f) => isControl(f.type)).length).toBe(4);
    const ns = wire.filter((f) => f.type === "event_forward").map((f) => f.n);
    expect(ns).toEqual(Array.from({ length: k }, (_, i) => i).slice(k === 11 ? 1 : 0));
  });

  // maxBufferSize 0 is rejected by the constructor (pinned by connection-inbound-pump), so the
  // boundary is forced on the private field.
  it.each([0, 1])("maxBufferSize=%i: each overflowing non-control is evicted, controls are kept", (max) => {
    const { cm, ws } = mk({ maxBufferSize: 1 });
    (cm as any).maxBufferSize = max;
    cm.send({ type: "session_register" });
    for (let n = 0; n < 3; n++) cm.send({ type: "event_forward", n });
    cm.send({ type: "replay_complete" });
    const wire = flush(ws);
    expect(wire.filter((f) => isControl(f.type)).map((f) => f.type)).toEqual(["session_register", "replay_complete"]);
    expect(wire.filter((f) => f.type === "event_forward").map((f) => f.n)).toEqual(max === 0 ? [] : [2]);
    expect(cm.getDroppedBufferedCount()).toBe(max === 0 ? 3 : 2);
  });

  // test-plan #E10
  it("preserves wire order: retained frames keep strictly increasing original indices", () => {
    const { cm, ws } = mk({ maxBufferSize: 3 });
    const types = [
      "session_register", "event_forward", "commands_list", "event_forward", "event_forward", "models_list",
      "event_forward", "replay_complete", "event_forward", "event_forward",
    ];
    const sent = types.map((type, n) => ({ type, n }));
    for (const f of sent) cm.send(f);
    expect(flush(ws).map((f) => f.n)).toEqual(expectedRetained(sent, 3));
    expect(expectedRetained(sent, 3)).toEqual([0, 2, 5, 6, 7, 8, 9]);
  });

  it("preserves wire order on 25 seeded random interleavings (all controls + last max non-controls)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      MockWebSocket.instances = [];
      const rnd = mulberry32(seed);
      const max = 1 + Math.floor(rnd() * 8);
      const total = 20 + Math.floor(rnd() * 40);
      const { cm, ws } = mk({ maxBufferSize: max });
      const sent = Array.from({ length: total }, (_, n) => ({
        n,
        type: rnd() < 0.3 ? CONTROL_TYPES[Math.floor(rnd() * CONTROL_TYPES.length)] : "event_forward",
      }));
      for (const f of sent) cm.send(f);
      const wire = flush(ws).map((f) => f.n as number);
      expect(wire, `seed ${seed}`).toEqual(expectedRetained(sent, max));
      expect(wire.every((v, i) => i === 0 || v > wire[i - 1]), `seed ${seed} order`).toBe(true);
    }
  });

  // test-plan #E11
  it.each([255, 256, 257])("bounds control frames at 256: N=%i controls + 10 non-control", (N) => {
    const { cm, ws } = mk({ maxBufferSize: 10 });
    const retained = () => (cm as any).controlQueue.length + (cm as any).otherQueue.length;
    for (let n = 0; n < N; n++) {
      cm.send({ type: "commands_list", n });
      expect(retained()).toBeLessThanOrEqual(10 + 256);
    }
    for (let n = 1000; n < 1010; n++) {
      cm.send({ type: "event_forward", n });
      expect(retained()).toBeLessThanOrEqual(10 + 256);
    }
    const wire = flush(ws);
    const ctl = wire.filter((f) => f.type === "commands_list").map((f) => f.n as number);
    // N<=256: all retained; N=257: exactly the oldest (n=0) evicted.
    expect(ctl).toEqual(Array.from({ length: N }, (_, i) => i).slice(N === 257 ? 1 : 0));
    expect(cm.getDroppedBufferedCount()).toBe(N === 257 ? 1 : 0);
  });

  // test-plan #E12
  it("counts control-cap evictions with the non-control ones, per type, as one monotonic total", () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cm } = mk({ maxBufferSize: 10 });
    for (let n = 0; n < 257; n++) cm.send({ type: n % 2 === 0 ? "session_unregister" : "commands_list", n });
    vi.advanceTimersByTime(5_001); // a new throttle window, so the next eviction reports
    for (let n = 0; n < 11; n++) cm.send({ type: "event_forward", n });
    expect(cm.getDroppedBufferedCount()).toBe(2);
    const last = warnLines(warnSpy).at(-1) as string;
    expect(typeCount(last, "session_unregister")).toBe(1); // the evicted OLDEST control (n=0)
    expect(typeCount(last, "event_forward")).toBe(1);
    expect(last).toContain("total dropped=2");
  });

  // test-plan #E13
  it("aggregates the throttled overflow warning by type, one line per 5 s window", () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cm } = mk({ maxBufferSize: 3 });
    for (let n = 0; n < 3; n++) cm.send({ type: "session_heartbeat", n });
    for (let n = 0; n < 20; n++) cm.send({ type: "event_forward", n }); // evicts 3 heartbeats + 17 events
    expect(warnLines(warnSpy).length).toBe(1); // one line inside the window
    vi.advanceTimersByTime(5_001);
    cm.send({ type: "event_forward", n: 20 }); // 18th event eviction
    const lines = warnLines(warnSpy);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("hop=bridge→server");
    expect(typeCount(lines[1], "session_heartbeat")).toBe(3); // covers ALL evictions, not just the first type
    expect(typeCount(lines[1], "event_forward")).toBe(18);
  });

  // test-plan #E14
  it("resets per-type counts on flush while the monotonic total keeps growing", () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cm, ws } = mk({ maxBufferSize: 2 });
    for (let n = 0; n < 7; n++) cm.send({ type: "event_forward", n }); // 5 evictions
    flush(ws);
    ws.readyState = 3; // socket drops again
    for (let n = 0; n < 3; n++) cm.send({ type: "event_forward", n }); // 1 eviction (silent: same window)
    vi.advanceTimersByTime(5_001);
    cm.send({ type: "event_forward", n: 3 }); // 2nd post-flush eviction → reports
    const last = warnLines(warnSpy).at(-1) as string;
    expect(typeCount(last, "event_forward")).toBe(2);
    expect(last).toContain("total dropped=7");
    expect(cm.getDroppedBufferedCount()).toBe(7);
  });

  // test-plan #E15 — pins the known residual (not widened, G2)
  it("keeps evictable: replay event_forward and one-shot sync frames (not pinned)", () => {
    const { cm, ws } = mk({ maxBufferSize: 2 });
    cm.send({ type: "session_register" });
    cm.send({ type: "event_forward", replay: true });
    cm.send({ type: "session_name_update" });
    cm.send({ type: "first_message_update" });
    cm.send({ type: "usage_recorded" });
    cm.send({ type: "session_heartbeat" });
    expect(flush(ws).map((f) => f.type)).toEqual(["session_register", "usage_recorded", "session_heartbeat"]);
    expect(cm.getDroppedBufferedCount()).toBe(3);
  });

  // test-plan #E16
  it("classifies frames with a missing / non-string type as non-control, reported as unknown", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cm, ws } = mk({ maxBufferSize: 1 });
    expect(() => {
      cm.send({});
      cm.send({ type: 5 });
      cm.send(null);
      cm.send({ type: "session_register" });
    }).not.toThrow();
    expect(cm.getDroppedBufferedCount()).toBe(2);
    expect(typeCount(warnLines(warnSpy)[0], "unknown")).toBe(1);
    ws.open();
    expect(ws.sent).toEqual(["null", JSON.stringify({ type: "session_register" })]);
  });

  // test-plan #E17
  describe("outboundFilter", () => {
    it("classifies each produced frame by its own type; [] buffers nothing", () => {
      const { cm, ws } = mk({ maxBufferSize: 1, outboundFilter: (m: any) => m.out });
      cm.send({ out: [] });
      expect((cm as any).controlQueue.length + (cm as any).otherQueue.length).toBe(0);
      expect(cm.getDroppedBufferedCount()).toBe(0);
      cm.send({ out: [{ type: "commands_list" }] });
      for (let n = 0; n < 3; n++) cm.send({ out: [{ type: "commands_list", n }, { type: "event_forward", n }] });
      // commands_list (control) never evicted: 1 + 3; event_forward: 3 sent, 1 retained, 2 evicted.
      expect(cm.getDroppedBufferedCount()).toBe(2);
      const wire = flush(ws);
      expect(wire.filter((f) => f.type === "commands_list").length).toBe(4);
      expect(wire.filter((f) => f.type === "event_forward").map((f) => f.n)).toEqual([2]);
    });

    it("a throwing filter fails closed for event_forward but still lets other frames through", () => {
      const { cm, ws } = mk({
        maxBufferSize: 5,
        outboundFilter: () => {
          throw new Error("boom");
        },
      });
      cm.send({ type: "event_forward", n: 0 });
      cm.send({ type: "commands_list" });
      expect(flush(ws).map((f) => f.type)).toEqual(["commands_list"]);
    });
  });

  // test-plan #X6
  it("keeps a session_register whose ws.send threw in the control queue, flushed first on reopen", () => {
    const { cm, ws } = mk({ maxBufferSize: 3 });
    ws.readyState = 1;
    ws.failSend = true;
    cm.send({ type: "session_register", sessionId: "s1" }); // send throws → buffered with its type
    ws.readyState = 0;
    for (let n = 0; n < 20; n++) cm.send({ type: "event_forward", n });
    ws.failSend = false;
    const wire = flush(ws);
    expect(wire[0].type).toBe("session_register");
    expect(wire.length).toBe(4);
  });

  // test-plan #P1 — generous CI bound (contended runners)
  it("evicts 10 000 frames without re-parsing and well inside the time bound", () => {
    const { cm } = mk(); // default maxBufferSize 10 000
    const frames = Array.from({ length: 20_000 }, (_, n) => ({ type: "event_forward", sessionId: "s1", n }));
    const parse = vi.spyOn(JSON, "parse");
    const t0 = performance.now();
    for (const f of frames) cm.send(f);
    const elapsed = performance.now() - t0;
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(cm.getDroppedBufferedCount()).toBe(10_000);
    expect(elapsed).toBeLessThan(1_000);
  });

  // test-plan #P2 — scaling ratio, median of 3 after a warm-up
  it("evicts in O(1) amortised: time(100k)/time(10k) stays well below the quadratic ratio", () => {
    const frames = (count: number) => Array.from({ length: count }, (_, n) => ({ type: "event_forward", n }));
    const f10k = frames(10_000);
    const f100k = frames(100_000);
    const run = (fs: unknown[]) => {
      const { cm } = mk({ maxBufferSize: 1_000 });
      const t0 = performance.now();
      for (const f of fs) cm.send(f);
      return performance.now() - t0;
    };
    const median = (fs: unknown[]) => [run(fs), run(fs), run(fs)].sort((a, b) => a - b)[1];
    run(f10k); // warm-up (JIT)
    const ratio = median(f100k) / Math.max(median(f10k), 0.05);
    expect(ratio).toBeLessThan(20);
  });

  // test-plan #P3
  it("retains at most maxBufferSize + 256 frames over 50 000 mixed frames", () => {
    const { cm, ws } = mk({ maxBufferSize: 1_000 });
    for (let i = 0; i < 50_000; i++) {
      const control = i % 5 < 2; // 40% control
      cm.send({ type: control ? CONTROL_TYPES[i % CONTROL_TYPES.length] : "event_forward", i });
    }
    ws.open();
    expect(ws.sent.length).toBeLessThanOrEqual(1_000 + 256);
    expect(ws.sent.length).toBeGreaterThan(0);
  });
});
