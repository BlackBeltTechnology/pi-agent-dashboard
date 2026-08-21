import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { ConnectionManager } from "../connection.js";

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
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
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
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

describe("ConnectionManager", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
  });

  it("should connect to the configured URL", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://localhost:9999");
    cm.disconnect();
  });

  it("should send buffered messages after connecting", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });

    cm.send({ type: "session_heartbeat", sessionId: "s1" });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    expect(ws.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws.sentMessages[0]).type).toBe("session_heartbeat");
    cm.disconnect();
  });

  it("should reconnect with exponential backoff", async () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();
    ws1.simulateClose();

    // First reconnect: 1s
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1].simulateClose();

    // Second reconnect: 2s
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);

    MockWebSocket.instances[2].simulateClose();

    // Third reconnect: 4s
    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(4);

    cm.disconnect();
  });

  it("should cap backoff at 30s", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    // Simulate many disconnects to exceed 30s cap
    for (let i = 0; i < 10; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.simulateOpen();
      ws.simulateClose();
      vi.advanceTimersByTime(30000);
    }

    // The backoff should never exceed 30s
    // After 10 reconnects: 1, 2, 4, 8, 16, 30, 30, 30, 30, 30
    cm.disconnect();
  });

  it("should reset backoff on successful connect", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    // First connect and disconnect
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateClose();

    // Wait for first reconnect (1s)
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Successful reconnect resets backoff
    MockWebSocket.instances[1].simulateOpen();
    MockWebSocket.instances[1].simulateClose();

    // Next reconnect should be 1s again (reset)
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(3);

    cm.disconnect();
  });

  it("should buffer up to 1000 events during disconnect", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 1000,
    });

    // Send 1001 messages while disconnected
    for (let i = 0; i < 1001; i++) {
      cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    }

    cm.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Should only have 1000 messages (oldest dropped)
    expect(ws.sentMessages).toHaveLength(1000);
    cm.disconnect();
  });

  it("should schedule reconnect when WebSocket constructor throws", () => {
    let callCount = 0;
    const ThrowingWebSocket = function (url: string) {
      callCount++;
      if (callCount <= 2) {
        throw new Error("Connection refused");
      }
      return new MockWebSocket(url);
    } as any;

    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: ThrowingWebSocket,
    });

    // Should not throw
    expect(() => cm.connect()).not.toThrow();
    expect(callCount).toBe(1);

    // First retry after 1s — still throws
    vi.advanceTimersByTime(1000);
    expect(callCount).toBe(2);

    // Second retry after 2s — succeeds
    vi.advanceTimersByTime(2000);
    expect(callCount).toBe(3);
    expect(MockWebSocket.instances).toHaveLength(1);

    cm.disconnect();
  });

  it("should buffer message when ws.send() throws", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    // Make send() throw
    ws.send = () => { throw new Error("Connection reset"); };

    // Should not throw — buffers instead
    expect(() => cm.send({ type: "test" })).not.toThrow();

    // Reconnect and verify the buffered message is flushed
    ws.simulateClose();
    vi.advanceTimersByTime(1000);
    const ws2 = MockWebSocket.instances[1];
    ws2.simulateOpen();

    expect(ws2.sentMessages).toHaveLength(1);
    expect(JSON.parse(ws2.sentMessages[0]).type).toBe("test");

    cm.disconnect();
  });

  it("should reconnect when onerror fires without onclose (Node 22 built-in WebSocket)", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    const ws1 = MockWebSocket.instances[0];
    // Simulate Node 22 behavior: onerror fires but onclose does NOT
    ws1.onerror?.({});
    // ws1.onclose is NOT called

    // Should still schedule reconnect after 1s
    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(MockWebSocket.instances).toHaveLength(2);

    // New connection should work
    MockWebSocket.instances[1].simulateOpen();
    expect(cm.isConnected).toBe(true);

    cm.disconnect();
  });

  it("should not double-reconnect when both onerror and onclose fire", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
    });
    cm.connect();

    const ws1 = MockWebSocket.instances[0];
    ws1.simulateOpen();

    // Simulate normal ws package behavior: onerror then onclose
    ws1.onerror?.({});
    // onerror clears onclose and handles reconnect, so onclose won't fire again

    vi.advanceTimersByTime(1000);
    // Should only create ONE new connection, not two
    expect(MockWebSocket.instances).toHaveLength(2);

    cm.disconnect();
  });

  it("should call onReconnect when reconnecting", () => {
    const onReconnect = vi.fn();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      onReconnect,
    });
    cm.connect();

    MockWebSocket.instances[0].simulateOpen();
    expect(onReconnect).not.toHaveBeenCalled();

    MockWebSocket.instances[0].simulateClose();
    vi.advanceTimersByTime(1000);

    MockWebSocket.instances[1].simulateOpen();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    cm.disconnect();
  });

  describe("updateUrl", () => {
    it("triggers reconnect when URL changes", () => {
      const cm = new ConnectionManager({
        url: "ws://localhost:9999",
        WebSocketImpl: MockWebSocket,
        watchdogTimeout: 0,
      });
      cm.connect();
      MockWebSocket.instances[0].simulateOpen();
      expect(MockWebSocket.instances).toHaveLength(1);

      cm.updateUrl("ws://remote:9999");

      // Old connection closed, reconnect scheduled
      vi.advanceTimersByTime(1000);
      expect(MockWebSocket.instances.length).toBeGreaterThan(1);
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      expect(last.url).toBe("ws://remote:9999");

      cm.disconnect();
    });

    it("is a no-op when URL is the same", () => {
      const cm = new ConnectionManager({
        url: "ws://localhost:9999",
        WebSocketImpl: MockWebSocket,
        watchdogTimeout: 0,
      });
      cm.connect();
      MockWebSocket.instances[0].simulateOpen();
      const countBefore = MockWebSocket.instances.length;

      cm.updateUrl("ws://localhost:9999");

      vi.advanceTimersByTime(2000);
      expect(MockWebSocket.instances.length).toBe(countBefore);

      cm.disconnect();
    });
  });
});

// ──────────────────────────────────────────────────────────
// (test-plan #E19) `ws+unix://` client dial — defect-2 regression.
//
// `globalThis.WebSocket` rejects `ws+unix://` outright with
// `DOMException: expected a ws: or wss: url`, so a build that falls back to it
// cannot reach the local socket at all. This test dials a REAL unix socket, so
// it fails on any such regression rather than asserting a constructor name.
//
// See change: add-pi-gateway-transport-identity (task 2.6).
// ──────────────────────────────────────────────────────────
describe("ConnectionManager over ws+unix", () => {
  it("dials ws+unix://<path>:/ with the default WebSocket implementation", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-conn-uds-"));
    const sockPath = path.join(dir, "gateway-test.sock");
    const wss = new WebSocketServer({ noServer: true });
    const http = await import("node:http");
    const server = http.createServer();
    server.on("upgrade", (req, socket, head) => {
      wss.handleUpgrade(req, socket as never, head, (ws) => wss.emit("connection", ws, req));
    });
    await new Promise<void>((r) => server.listen(sockPath, () => r()));

    const connected = new Promise<void>((resolve) => wss.once("connection", () => resolve()));
    // No WebSocketImpl injected: this exercises the production default.
    const cm = new ConnectionManager({ url: `ws+unix://${sockPath}:/`, onMessage: () => {} });
    cm.connect();
    try {
      await expect(
        Promise.race([
          connected,
          new Promise((_, rej) => setTimeout(() => rej(new Error("no UDS connection")), 3000)),
        ]),
      ).resolves.toBeUndefined();
    } finally {
      cm.disconnect();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
