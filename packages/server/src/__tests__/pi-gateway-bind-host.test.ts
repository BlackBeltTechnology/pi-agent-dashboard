/**
 * Tests for configurable bind host on the pi gateway WebSocket server.
 * See change: configurable-bind-host.
 */

import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createPiGateway } from "../pi/pi-gateway.js";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/** Poll gateway.address() until the async listen resolves a port. */
async function waitForBind(gateway: { address(): number | null }): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const port = gateway.address();
    if (port !== null) return port;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("gateway did not bind a port");
}

/** First non-internal IPv4 address, or null when host has none. */
function nonLoopbackIPv4(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const info of addrs ?? []) {
      if (!info.internal && info.family === "IPv4") return info.address;
    }
  }
  return null;
}

describe("pi-gateway bind host", () => {
  let gateway: ReturnType<typeof createPiGateway>;

  afterEach(() => {
    gateway?.stop();
  });

  it("binds loopback only when host is 127.0.0.1", async () => {
    const lan = nonLoopbackIPv4();
    if (!lan) return; // No routable interface to probe — nothing to assert.

    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);

    // Loopback reachable.
    const loop = new WebSocket(`ws://127.0.0.1:${port}`);
    await expect(waitForOpen(loop)).resolves.toBeUndefined();
    loop.close();

    // Non-loopback interface NOT reachable (connection refused).
    const lanWs = new WebSocket(`ws://${lan}:${port}`);
    await expect(waitForOpen(lanWs)).rejects.toThrow();
    lanWs.terminate();
  });

  it("binds all interfaces when host is 0.0.0.0", async () => {
    const lan = nonLoopbackIPv4();
    if (!lan) return;

    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "0.0.0.0");
    const port = await waitForBind(gateway);

    const lanWs = new WebSocket(`ws://${lan}:${port}`);
    await expect(waitForOpen(lanWs)).resolves.toBeUndefined();
    lanWs.close();
  });
});
