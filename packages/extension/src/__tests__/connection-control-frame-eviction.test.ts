/**
 * Overflow eviction must never sacrifice a session-lifecycle control frame.
 *
 * On a `pi --session` resume the bridge queues `session_unregister` +
 * `session_register` ahead of a full event replay (~2-3 frames per entry)
 * while the socket is not yet OPEN; a large session overflows the bounded
 * send ring, and drop-oldest evicted exactly those control frames — the
 * server then dropped the whole unowned replay and the session never
 * registered (invisible in the dashboard for the life of the socket, which
 * stayed ESTABLISHED). See change: fix-register-evicted-on-replay-overflow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  public url: string;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const register = { type: "session_register", sessionId: "s1", cwd: "/x" };

describe("ConnectionManager control-frame eviction protection", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers session_register queued ahead of an overflow on open", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 10,
    });
    cm.connect();
    // Never connect → everything buffers; a replay storm overflows the ring.
    cm.send(register);
    for (let i = 0; i < 20; i++) cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    expect(cm.getDroppedBufferedCount()).toBe(11);
    const ws = MockWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.();
    const sentTypes = ws.sent.map((d) => JSON.parse(d).type);
    expect(sentTypes[0]).toBe("session_register");
    expect(sentTypes.filter((t) => t === "session_register")).toHaveLength(1);
    expect(sentTypes.filter((t) => t === "event_forward")).toHaveLength(9);
  });

  it("protects session_unregister and session_move_commit equally", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 5,
    });
    cm.connect();
    cm.send({ type: "session_unregister", sessionId: "s1" });
    cm.send({ type: "session_move_commit", sessionId: "s1", token: "t" });
    cm.send(register);
    for (let i = 0; i < 12; i++) cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    const ws = MockWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.();
    const sentTypes = ws.sent.map((d) => JSON.parse(d).type);
    expect(sentTypes).toContain("session_unregister");
    expect(sentTypes).toContain("session_move_commit");
    expect(sentTypes).toContain("session_register");
  });

  it("protects a control frame queued AFTER data frames", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 4,
    });
    cm.connect();
    for (let i = 0; i < 3; i++) cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    cm.send(register);
    for (let i = 3; i < 15; i++) cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    const ws = MockWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.();
    const sent = ws.sent.map((d) => JSON.parse(d));
    expect(sent.some((m) => m.type === "session_register")).toBe(true);
    // Relative order of the survivors is unchanged: no event sent after the
    // register may precede it on the wire, and retained events stay in order.
    const registerAt = sent.findIndex((m) => m.type === "session_register");
    const events = sent.filter((m) => m.type === "event_forward");
    for (const event of events) {
      if (event.event.i >= 0) expect(sent.indexOf(event)).toBeGreaterThan(registerAt);
    }
    for (let i = 1; i < events.length; i++) expect(events[i].event.i).toBeGreaterThan(events[i - 1].event.i);
  });

  it("survives a realistic replay storm at the default 10,000 capacity", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();
    cm.send({ type: "session_unregister", sessionId: "s1" });
    cm.send(register);
    for (let i = 0; i < 10_002; i++) cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    expect(cm.getDroppedBufferedCount()).toBeGreaterThanOrEqual(2);
    const ws = MockWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.();
    const sentTypes = ws.sent.map((d) => JSON.parse(d).type);
    expect(sentTypes[0]).toBe("session_unregister");
    expect(sentTypes[1]).toBe("session_register");
  });
});
