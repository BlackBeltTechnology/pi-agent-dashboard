/**
 * Integration test: shutdown fallback kills headless process when bridge is disconnected.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type DashboardServer } from "../server.js";
import { WebSocket } from "ws";
import { spawn } from "node:child_process";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

function collectMsgs(ws: WebSocket, ms: number): Promise<any[]> {
  return new Promise((resolve) => {
    const arr: any[] = [];
    const h = (raw: any) => arr.push(JSON.parse(raw.toString()));
    ws.on("message", h);
    setTimeout(() => { ws.off("message", h); resolve(arr); }, ms);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let httpPort: number;
let piPort: number;
let server: DashboardServer;

describe("Headless shutdown fallback", () => {
  beforeEach(async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterEach(async () => {
    if (server) await server.stop();
  });

  it("should kill headless process via SIGTERM when bridge is disconnected", async () => {
    // Spawn a real dummy process (sleep) to act as the headless pi session
    const dummy = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    dummy.unref();
    const pid = dummy.pid!;

    // Register it in the headless registry with a known cwd
    const registry = server.browserGateway.headlessPidRegistry;
    registry.register(pid, "/test/cwd", dummy);

    // Simulate bridge connecting and registering with that cwd
    const bridge = new WebSocket(`ws://127.0.0.1:${piPort}`);
    await waitForOpen(bridge);
    bridge.send(JSON.stringify({
      type: "session_register", sessionId: "headless-1", cwd: "/test/cwd", source: "tui",
    }));
    // Wait for session_register to be processed (may need longer under load)
    for (let i = 0; i < 20; i++) {
      if (registry.getPid("headless-1") !== undefined) break;
      await delay(50);
    }

    // Verify the session got linked
    expect(registry.getPid("headless-1")).toBe(pid);

    // Now disconnect the bridge (simulating bridge gone)
    bridge.close();
    await delay(200);

    // Browser sends shutdown — bridge is disconnected, should fallback to kill
    const browser = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    await waitForOpen(browser);
    await delay(100);

    browser.send(JSON.stringify({ type: "shutdown", sessionId: "headless-1" }));
    await delay(300);

    // Verify process was killed
    let alive = true;
    try {
      process.kill(pid, 0); // signal 0 = check if alive
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);

    browser.close();
    await delay(50);
  }, 15000);

  it("should not crash when no PID is linked for shutdown", async () => {
    const browser = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    await waitForOpen(browser);
    await delay(100);

    // Send shutdown for an unknown session — should not crash
    browser.send(JSON.stringify({ type: "shutdown", sessionId: "nonexistent" }));
    await delay(200);

    // If we get here without crashing, it's a pass
    expect(browser.readyState).toBe(WebSocket.OPEN);

    browser.close();
    await delay(50);
  }, 10000);
});
