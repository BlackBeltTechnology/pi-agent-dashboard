/**
 * Gateway: headless `kind="automation"` sessions treat a WebSocket close as
 * terminal immediately (no reconnect grace), while every other session keeps
 * the human-oriented grace window. See change:
 * finalize-automation-run-on-session-death.
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

// Long heartbeat so any status change within the window can ONLY come from the
// automation close-is-terminal path, never from a heartbeat timeout.
const LONG_HB = 5000;
let portCounter = 19540;

describe("automation session close is terminal", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  afterEach(() => gateway?.stop());

  it("finalizes a kind=automation session immediately on WS close (no grace)", async () => {
    const sm = createMemorySessionManager();
    const ended: string[] = [];
    sm.onUnregister = (sid) => ended.push(sid);
    gateway = createPiGateway(sm, { heartbeatTimeout: LONG_HB });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "auto-1", cwd: "/tmp", source: "dashboard" }));
    await delay(100);
    // The host stamps kind="automation" on register; emulate that here.
    sm.update("auto-1", { kind: "automation" });
    expect(sm.get("auto-1")!.status).toBe("active");

    ws.close();
    await delay(200); // well under LONG_HB

    expect(sm.get("auto-1")!.status).toBe("ended");
    expect(ended).toContain("auto-1"); // onUnregister → plugin onSessionEnded → engine finalize
  }, 10000);

  it("keeps the reconnect grace for a non-automation session on WS close", async () => {
    const sm = createMemorySessionManager();
    gateway = createPiGateway(sm, { heartbeatTimeout: LONG_HB });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "human-1", cwd: "/tmp", source: "tui" }));
    await delay(100);
    expect(sm.get("human-1")!.status).toBe("active");

    ws.close();
    await delay(200);

    // Still active: grace window unchanged (would end only after the heartbeat timeout).
    expect(sm.get("human-1")!.status).toBe("active");
  }, 10000);
});
