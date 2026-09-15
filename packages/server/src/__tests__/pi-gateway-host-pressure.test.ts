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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Open a bridge socket against the gateway under test. */
async function openBridge(): Promise<WebSocket> {
  const ws = new WebSocket(`ws+unix://${sockPath}:/`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

function register(ws: WebSocket, sessionId: string, extra: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: tmp, pid: process.pid, ...extra }));
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

  // ── X2: carrier loss is not host pressure ───────────────────────────────
  // An OPEN bridge socket is a PRECONDITION of the signal. A closed carrier is
  // a disconnect, already owned by the heartbeat/status machinery; reporting it
  // as host pressure would double-badge it.
  it("X2: a bridge socket that closes without unregistering emits no verdict", async () => {
    const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
    gateway = createPiGateway(createMemorySessionManager(), {
      pingInterval: 0,
      hostPressureDegradedMs: 60,
      hostPressureUnresponsiveMs: 120,
      onHostPressure: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
    });
    await gateway.startOnSocket(sockPath);

    const ws = await openBridge();
    register(ws, "press-closed");
    await waitFor(() => gateway?.isSessionConnected("press-closed") === true);

    // No `session_unregister` — the socket just goes away.
    ws.close();
    await waitFor(() => (gateway?.hostPressureTrackedCount() ?? 1) === 0);

    // Well past BOTH thresholds: silence on a dead carrier is not pressure.
    await sleep(300);
    expect(emissions).toEqual([]);
    expect(gateway.hostPressureTrackedCount()).toBe(0);
  });

  // A verdict already on the row is RETRACTED when the carrier dies, not just
  // forgotten — otherwise a partition with no FIN leaves the card ticking
  // "unresponsive" for the whole reconnect grace, with the tracker no longer
  // able to transition it back. See change: fix-false-unresponsive-badge.
  it("X2b: a socket that dies while PRESSURED emits an explicit clear", async () => {
    const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
    gateway = createPiGateway(createMemorySessionManager(), {
      pingInterval: 0,
      hostPressureDegradedMs: 60,
      hostPressureUnresponsiveMs: 120,
      onHostPressure: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
    });
    await gateway.startOnSocket(sockPath);

    const ws = await openBridge();
    register(ws, "press-partition");
    await waitFor(() => gateway?.isSessionConnected("press-partition") === true);

    // The socket stays open long enough for the verdict to land …
    await waitFor(() => emissions.length >= 2);
    expect(emissions.map((e) => e.pressure?.state)).toEqual(["degraded", "unresponsive"]);

    // … then the carrier finally goes away.
    ws.close();
    await waitFor(() => emissions.length >= 3);

    expect(emissions.at(-1)).toEqual({ sessionId: "press-partition", pressure: null });
    expect(gateway.hostPressureTrackedCount()).toBe(0);
  });

  // ── X3: no tracking state survives a dead session ───────────────────────
  // Each exit path must release the map entry AND its two timers. The
  // heartbeat-timeout / sleep-retry sites are only reachable once the socket is
  // already gone (they check `readyState` first), so the socket-close case
  // below is the reachable shape of that family; the tracked-count oracle is
  // the same for all of them.
  describe("X3: every exit path releases the tracker entry", () => {
    async function trackedGateway(emissions: Array<{ sessionId: string; pressure: HostPressure | null }>) {
      const gw = createPiGateway(createMemorySessionManager(), {
        pingInterval: 0,
        heartbeatTimeout: 80,
        hostPressureDegradedMs: 60,
        hostPressureUnresponsiveMs: 120,
        onHostPressure: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
      });
      await gw.startOnSocket(sockPath);
      return gw;
    }

    it("explicit session_unregister", async () => {
      const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
      gateway = await trackedGateway(emissions);
      const ws = await openBridge();
      register(ws, "exit-explicit");
      await waitFor(() => gateway?.hostPressureTrackedCount() === 1);

      ws.send(JSON.stringify({ type: "session_unregister", sessionId: "exit-explicit" }));
      await waitFor(() => gateway?.hostPressureTrackedCount() === 0);

      await sleep(300);
      expect(gateway.hostPressureTrackedCount()).toBe(0);
      expect(emissions).toEqual([]);
    });

    it("heartbeat/grace expiry after the carrier is gone", async () => {
      const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
      gateway = await trackedGateway(emissions);
      const ws = await openBridge();
      register(ws, "exit-heartbeat");
      await waitFor(() => gateway?.hostPressureTrackedCount() === 1);

      ws.close();
      // Past the heartbeat timeout AND both pressure thresholds.
      await sleep(400);
      expect(gateway.hostPressureTrackedCount()).toBe(0);
      expect(emissions).toEqual([]);
    });

    it("reload placeholder swap releases the OLD id, not just the new one", async () => {
      const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
      gateway = await trackedGateway(emissions);
      const ws = await openBridge();
      register(ws, "exit-old");
      await waitFor(() => gateway?.hostPressureTrackedCount() === 1);

      // Same socket re-registers under a new id (the /reload shape). The old
      // placeholder row is torn down — its tracker entry must go with it.
      register(ws, "exit-new");
      await waitFor(() => gateway?.isSessionConnected("exit-new") === true);

      expect(gateway.hostPressureTrackedCount()).toBe(1);
      await waitFor(() => emissions.length >= 1);
      // Only the surviving id can ever be the subject of a verdict.
      expect(new Set(emissions.map((e) => e.sessionId))).toEqual(new Set(["exit-new"]));
    });
  });

  // ── P1: the cost promise ────────────────────────────────────────────────
  it("P1: a bridge that keeps framing costs zero host-pressure frames", async () => {
    const emissions: Array<{ sessionId: string; pressure: HostPressure | null }> = [];
    gateway = createPiGateway(createMemorySessionManager(), {
      pingInterval: 0,
      hostPressureDegradedMs: 100,
      hostPressureUnresponsiveMs: 200,
      onHostPressure: (sessionId, pressure) => emissions.push({ sessionId, pressure }),
    });
    await gateway.startOnSocket(sockPath);

    const ws = await openBridge();
    register(ws, "press-healthy");
    await waitFor(() => gateway?.isSessionConnected("press-healthy") === true);

    // Frame at a third of the degraded threshold for 4× that threshold.
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      ws.send(JSON.stringify({ type: "session_heartbeat", sessionId: "press-healthy" }));
      await sleep(30);
    }

    expect(emissions).toEqual([]);
  });
});
