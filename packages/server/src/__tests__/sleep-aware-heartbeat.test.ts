/**
 * Tests for sleep-aware heartbeat in pi-gateway.
 */
import { describe, it, expect, afterEach } from "vitest";
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

function makeTempSessionManager() {
  return createMemorySessionManager();
}

// Use a short heartbeat for fast tests
const SHORT_HB = 300; // 300ms
let portCounter = 19390;

describe("Sleep-aware heartbeat", () => {
  let gateway: ReturnType<typeof createPiGateway>;

  afterEach(() => {
    gateway?.stop();
  });

  it("should unregister session after normal heartbeat timeout", async () => {
    const sessionManager = makeTempSessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: SHORT_HB });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "s1", cwd: "/tmp", source: "tui",
    }));
    await delay(100);
    expect(sessionManager.get("s1")!.status).toBe("active");

    // Close without unregister
    ws.close();
    await delay(100);

    // Wait for heartbeat timeout
    await delay(SHORT_HB + 200);

    expect(sessionManager.get("s1")!.status).toBe("ended");
  }, 10000);

  it("should call onEmpty after heartbeat timeout", async () => {
    const sessionManager = makeTempSessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: SHORT_HB });
    const port = portCounter++;
    gateway.start(port);

    let emptyCalled = false;
    gateway.onEmpty = () => { emptyCalled = true; };

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "s2", cwd: "/tmp", source: "tui",
    }));
    await delay(100);

    ws.close();
    // Heartbeat timeout now has a reconnect grace-period retry (same duration),
    // so the terminal onEmpty fires after ~2× SHORT_HB + slack.
    await delay(SHORT_HB * 2 + 400);

    expect(emptyCalled).toBe(true);
  }, 10000);

  it("should retry once when sleep is detected (simulated via Date.now override)", async () => {
    const sessionManager = makeTempSessionManager();
    // Use a longer timeout so we can manipulate Date.now between calls
    const HB = 500;
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: HB });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "s3", cwd: "/tmp", source: "tui",
    }));
    await delay(100);
    expect(sessionManager.get("s3")!.status).toBe("active");

    // Close connection
    ws.close();
    await delay(50);

    // Simulate sleep: make Date.now() jump forward far beyond 2× timeout
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;

    // Jump time forward to simulate sleep (10× timeout = clearly > 2×)
    offset = HB * 10;

    // Wait for the heartbeat timer to fire (it uses real setTimeout)
    await delay(HB + 200);

    // Session should still be active (sleep detected, one retry granted)
    expect(sessionManager.get("s3")!.status).toBe("active");

    // Reset time back to normal
    offset = 0;

    // Wait for the retry heartbeat to fire
    await delay(HB + 200);

    // Now it should be ended (second timeout, no sleep detected)
    expect(sessionManager.get("s3")!.status).toBe("ended");

    Date.now = realNow;
  }, 10000);
});
