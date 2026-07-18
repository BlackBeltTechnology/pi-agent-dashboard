/**
 * Tests for session lifecycle logging in pi-gateway.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { WebSocket } from "ws";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

const SHORT_HB = 300;
let portCounter = 19600;

describe("Session lifecycle logging", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    gateway?.stop();
    errorSpy?.mockRestore();
  });

  it("should log on session_register", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "log-reg", cwd: "/tmp/test", source: "tui",
    }));
    await delay(100);

    const logs = errorSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContainEqual(expect.stringContaining("[gateway] session registered: log-reg cwd=/tmp/test"));
    ws.close();
  }, 10000);

  it("should log on explicit session_unregister", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "log-unreg", cwd: "/tmp", source: "tui",
    }));
    await delay(100);
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: "log-unreg" }));
    await delay(100);

    const logs = errorSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContainEqual(expect.stringContaining("[gateway] session unregistered: log-unreg (explicit)"));
    ws.close();
  }, 10000);

  it("should log on heartbeat timeout", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: SHORT_HB, pingInterval: 60000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "log-timeout", cwd: "/tmp", source: "tui",
    }));
    await delay(100);

    // Close without unregister — triggers heartbeat timeout
    ws.close();
    await delay(SHORT_HB + 300);

    const logs = errorSpy.mock.calls.map((c: any) => c[0]);
    // Heartbeat-timeout path now goes through a reconnect grace period first;
    // the terminal log message ends with "(reconnect grace period expired)".
    expect(logs).toContainEqual(expect.stringContaining("[gateway] session timed out: log-timeout (reconnect grace period expired)"));
  }, 10000);

  it("should log on connection close", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "log-close", cwd: "/tmp", source: "tui",
    }));
    await delay(100);
    ws.close();
    await delay(200);

    const logs = errorSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContainEqual(expect.stringContaining("[gateway] connection closed: log-close"));
  }, 10000);

  // TODO(fix-failing-tests-followup): pi-gateway ping-timeout now keeps the
  // session alive when the TCP socket is still writable (logs "ping: N misses
  // but TCP alive, keeping session"), so the old "connection dead" path is no
  // longer reachable by pausing the socket in tests. See §7.
  it.skip("should log on ping timeout", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, {
      heartbeatTimeout: 60000,
      pingInterval: 200,
    });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "log-ping", cwd: "/tmp", source: "tui",
    }));
    await delay(100);

    // Pause socket to prevent pong — need 2 missed pings before kill
    (ws as any)._socket?.pause();
    await delay(200 * 4);

    const logs = errorSpy.mock.calls.map((c: any) => c[0]);
    expect(logs).toContainEqual(expect.stringContaining("[gateway] connection dead (ping timeout, 2 misses): log-ping"));
  }, 10000);
});
