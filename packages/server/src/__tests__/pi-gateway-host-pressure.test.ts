/**
 * Gateway → host-pressure wiring over a real socket.
 *
 * The tracker itself is unit-tested (`session/__tests__/host-pressure-tracker.test.ts`);
 * what can only be proven here is that the gateway FEEDS it: a registered bridge
 * that then goes quiet must raise a verdict, and any frame it sends must clear
 * one. The bug this replaces shipped because the signal was never wired to the
 * browser at all. See change: fix-false-unresponsive-badge.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import type { HostPressure } from "../session/host-pressure-tracker.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

let tmp: string;
let sockPath: string;
let gateway: ReturnType<typeof createPiGateway> | null = null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-press-"));
  sockPath = path.join(tmp, "gateway-9999.sock");
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  gateway?.stop();
  gateway = null;
  await new Promise((r) => setTimeout(r, 20));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  for (let i = 0; i < timeoutMs / 10 && !predicate(); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("pi-gateway host pressure", () => {
  it("raises a verdict when a registered bridge goes quiet, and clears it on the next frame", async () => {
    const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, {
      pingInterval: 0,
      hostPressureDegradedMs: 60,
      hostPressureUnresponsiveMs: 120,
      onHostPressure: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
    });
    await gateway.startOnSocket(sockPath);

    const ws = new WebSocket(`ws+unix://${sockPath}:/`);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({ type: "session_register", sessionId: "press-1", cwd: tmp, pid: process.pid }));
    await waitFor(() => gateway?.isSessionConnected("press-1") === true);

    // Silence → degraded, then unresponsive.
    await waitFor(() => emissions.length >= 2);
    expect(emissions.map((e) => e.pressure?.state)).toEqual(["degraded", "unresponsive"]);
    expect(emissions[0]?.sessionId).toBe("press-1");
    expect(emissions[0]?.pressure?.since).toBeLessThanOrEqual(Date.now());

    // A heartbeat proves the loop runs again → explicit clear.
    emissions.length = 0;
    ws.send(JSON.stringify({ type: "session_heartbeat", sessionId: "press-1" }));
    await waitFor(() => emissions.length >= 1);
    expect(emissions[0]).toEqual({ sessionId: "press-1", pressure: null });
  });
});
