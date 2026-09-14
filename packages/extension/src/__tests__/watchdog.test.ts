import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionManager } from "../connection.js";

// Mock WebSocket (same pattern as connection.test.ts)
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

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }
}

describe("ConnectionManager watchdog", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  it("should force-close when no messages received for watchdogTimeout", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Advance past watchdog timeout (checked every 15s)
    vi.advanceTimersByTime(60_000);

    // Watchdog should have triggered — ws should be closed and reconnect scheduled
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
    // The connection should have been torn down
    expect(cm.isConnected).toBe(false);

    cm.disconnect();
  });

  it("should NOT force-close when messages are received regularly", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Send messages every 20s to keep watchdog happy
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(20_000);
      ws.simulateMessage(JSON.stringify({ type: "heartbeat_ack" }));
    }

    // Should still be connected (100s elapsed, but messages kept coming)
    expect(cm.isConnected).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    cm.disconnect();
  });

  it("should stop watchdog on disconnect", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Disconnect before watchdog fires
    cm.disconnect();

    // Advance past timeout — should not create new connections
    vi.advanceTimersByTime(120_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("should be disabled when watchdogTimeout is 0", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 0,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Advance way past any timeout — should stay connected
    vi.advanceTimersByTime(300_000);
    expect(cm.isConnected).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);

    cm.disconnect();
  });

  it("reports why it force-closed, so a reconnect is not mistaken for a network drop", () => {
    const onWatchdogFire = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // One ack lands at t=20s, then silence. The watchdog ticks on a 15s grid
    // from t=0, so the first tick seeing >=60s of silence is t=90s.
    vi.advanceTimersByTime(20_000);
    ws.simulateMessage(JSON.stringify({ type: "heartbeat_ack" }));
    vi.advanceTimersByTime(70_000);

    expect(onWatchdogFire).toHaveBeenCalledTimes(1);
    const info = onWatchdogFire.mock.calls[0][0];
    // Age is the load-bearing number: it separates "server truly silent"
    // from "timer fired ahead of queued socket reads".
    expect(info.silentForMs).toBeGreaterThanOrEqual(60_000);
    expect(info.watchdogTimeout).toBe(60_000);
    expect(info.readyState).toBe(1);

    cm.disconnect();
  });

  it("does not report a force-close when the server stays responsive", () => {
    const onWatchdogFire = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(20_000);
      ws.simulateMessage(JSON.stringify({ type: "heartbeat_ack" }));
    }

    expect(onWatchdogFire).not.toHaveBeenCalled();

    cm.disconnect();
  });

  it("reports ~zero tick drift when the loop was never blocked", () => {
    const onWatchdogFire = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire,
    });
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();

    // Timers fire on schedule: the server is silent, but our loop is healthy.
    vi.advanceTimersByTime(60_000);

    const info = onWatchdogFire.mock.calls[0][0];
    expect(info.maxTickDriftMs).toBeLessThan(1_000);
    // Server-silence signature: silence at the threshold, no drift.
    expect(info.silentForMs).toBeGreaterThanOrEqual(60_000);

    cm.disconnect();
  });

  it("reports large tick drift when the event loop was blocked", () => {
    const onWatchdogFire = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire,
    });
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();

    // One healthy tick, then the wall clock jumps without timers firing --
    // exactly what a blocked event loop looks like from inside the process.
    vi.advanceTimersByTime(15_000);
    vi.setSystemTime(Date.now() + 90_000);
    vi.advanceTimersByTime(15_000);

    expect(onWatchdogFire).toHaveBeenCalledTimes(1);
    const info = onWatchdogFire.mock.calls[0][0];
    // Blocked-loop signature: the watchdog's OWN tick was late.
    expect(info.maxTickDriftMs).toBeGreaterThanOrEqual(85_000);

    cm.disconnect();
  });

  it("a throwing reporter does not block the force-close or the reconnect", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire: () => {
        throw new Error("diagnostic sink exploded");
      },
    });
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();

    vi.advanceTimersByTime(60_000);
    expect(cm.isConnected).toBe(false);

    // Reconnect still scheduled despite the throw.
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    cm.disconnect();
  });

  it("reports readyState as captured BEFORE teardown nulls the socket", () => {
    const onWatchdogFire = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onWatchdogFire,
    });
    cm.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    vi.advanceTimersByTime(60_000);

    // OPEN(1), not CLOSED(3): we hung up on a socket the transport thought fine.
    expect(onWatchdogFire.mock.calls[0][0].readyState).toBe(1);
    expect(ws.readyState).toBe(3);

    cm.disconnect();
  });

  it("should reconnect after watchdog triggers", () => {
    const onReconnect = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 60_000,
      onReconnect,
    });
    cm.connect();

    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // Let watchdog trigger
    vi.advanceTimersByTime(60_000);
    expect(cm.isConnected).toBe(false);

    // Reconnect timer fires (1s backoff)
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    // Simulate successful reconnect
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws2.simulateOpen();
    expect(cm.isConnected).toBe(true);
    expect(onReconnect).toHaveBeenCalled();

    cm.disconnect();
  });
});
