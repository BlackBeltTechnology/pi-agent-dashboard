/**
 * Tests for heartbeat_ack response in pi-gateway.
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

let portCounter = 19550;

describe("heartbeat_ack", () => {
  let gateway: ReturnType<typeof createPiGateway>;

  afterEach(() => {
    gateway?.stop();
  });

  it("should respond with heartbeat_ack when receiving session_heartbeat", async () => {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);

    // Register session first
    ws.send(JSON.stringify({
      type: "session_register", sessionId: "ack-test", cwd: "/tmp", source: "tui",
    }));
    await delay(100);

    // Collect messages
    const messages: any[] = [];
    ws.on("message", (raw) => {
      messages.push(JSON.parse(raw.toString()));
    });

    // Send heartbeat
    ws.send(JSON.stringify({
      type: "session_heartbeat", sessionId: "ack-test",
    }));
    await delay(100);

    // Should have received heartbeat_ack
    const ack = messages.find((m) => m.type === "heartbeat_ack");
    expect(ack).toBeDefined();
    expect(ack.type).toBe("heartbeat_ack");

    ws.close();
  }, 10000);
});
