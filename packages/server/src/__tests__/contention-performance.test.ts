/**
 * Performance budgets for the contention rule.
 *
 * Covers test-plan #P1 (the uncontended fast path stays fast), #P2 (a contended
 * register resolves inside its bounded window and never hangs the connection
 * handler) and #P3 (an old bridge looping refused registers cannot flood the
 * log or grow the health payload).
 *
 * P3 is a 5-minute soak: opt in with `RUN_CONTENTION_SOAK=1`, so `npm test`
 * stays fast.
 *
 * See change: fix-duplicate-bridge-registration.
 */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { CONTENTION_RATE_LIMIT } from "../pi/bridge-contention.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

async function waitForBind(gateway: { address(): number | string | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = gateway.address();
    if (typeof port === "number") return port;
    await delay(10);
  }
  throw new Error("gateway did not bind a port");
}

const SOAK = process.env.RUN_CONTENTION_SOAK === "1";

describe("contention performance", () => {
  let gateway: ReturnType<typeof createPiGateway>;
  const sockets: WebSocket[] = [];

  afterEach(() => {
    for (const ws of sockets) ws.terminate();
    sockets.length = 0;
    gateway?.stop();
  });

  async function start(opts: Record<string, unknown> = {}) {
    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0, ...opts });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);
    return { sessionManager, port };
  }

  async function client(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("error", () => {});
    sockets.push(ws);
    await waitForOpen(ws);
    return ws;
  }

  function reg(ws: WebSocket, sessionId: string, extra: Record<string, unknown> = {}) {
    ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/w", source: "tui", ...extra }));
  }

  // ── P1 ────────────────────────────────────────────────────────────────────
  it("P1: 200 sequential uncontended registers stay on the fast path", async () => {
    const { sessionManager, port } = await start();
    const ws = await client(port);

    const N = 200;
    const started = Date.now();
    for (let i = 0; i < N; i++) {
      reg(ws, `perf-${i}`, { pid: 1000 + i });
    }
    // Every id lands.
    for (let i = 0; i < 600; i++) {
      if (sessionManager.get(`perf-${N - 1}`)) break;
      await delay(10);
    }
    const elapsed = Date.now() - started;

    expect(sessionManager.get(`perf-${N - 1}`)).toBeDefined();
    // The uncontended path issues NO probe, so 200 registers must complete far
    // inside a single probe window. A regression that probed the fast path
    // would need 200 x 5 s here.
    expect(elapsed).toBeLessThan(5_000);
    // Per-register added latency budget (< 5 ms) at the aggregate level.
    expect(elapsed / N).toBeLessThan(5);
  }, 30000);

  // ── P2 ────────────────────────────────────────────────────────────────────
  it("P2: a contended register against a silent-but-writable incumbent resolves in one window", async () => {
    const probeWindow = 1_000;
    const { port } = await start({ contentionProbeWindow: probeWindow });

    const a = await client(port);
    reg(a, "S", { pid: 1111 });
    await delay(200);
    // Silent but writable — the busy-bridge case, which must consume the whole
    // window and then refuse.
    (a as any)._socket?.pause();

    const b = await client(port);
    const closed = new Promise<void>((r) => b.on("close", () => r()));
    const started = Date.now();
    reg(b, "S", { pid: 2222 });
    await closed;
    const elapsed = Date.now() - started;

    // Bounded below by the window (it really waited) and above by a small
    // multiple of it (it never hung).
    expect(elapsed).toBeGreaterThanOrEqual(probeWindow * 0.9);
    expect(elapsed).toBeLessThan(probeWindow * 3);

    // The connection handler was never blocked: another socket registers a
    // different id promptly while the probe is in flight.
    const c = await client(port);
    const t0 = Date.now();
    reg(c, "OTHER");
    for (let i = 0; i < 200; i++) {
      if (gateway.isSessionConnected("OTHER")) break;
      await delay(10);
    }
    expect(gateway.isSessionConnected("OTHER")).toBe(true);
    expect(Date.now() - t0).toBeLessThan(probeWindow);
  }, 30000);

  // ── P3 ────────────────────────────────────────────────────────────────────
  it.runIf(SOAK)(
    "P3: an old bridge looping refused registers is rate-limited and the payload stays flat",
    async () => {
      const { port } = await start({ contentionProbeWindow: 200 });

      const a = await client(port);
      reg(a, "S", { pid: 1111 });
      await delay(200);

      const durationMs = 5 * 60_000;
      const started = Date.now();
      let attempts = 0;

      while (Date.now() - started < durationMs) {
        const b = await client(port);
        const closed = new Promise<void>((r) => b.on("close", () => r()));
        reg(b, "S", { pid: 2222 });
        await closed;
        b.terminate();
        attempts++;
        await delay(500);
      }

      const elapsed = Date.now() - started;
      const maxEmissions = Math.ceil(elapsed / CONTENTION_RATE_LIMIT) + 1;

      // Every attempt counted …
      expect(gateway.contention.count()).toBe(attempts);
      expect(attempts).toBeGreaterThan(maxEmissions);
      // … but the health payload stays a single id, not one entry per attempt.
      expect(gateway.contention.contendedIds()).toEqual(["S"]);
    },
    6 * 60_000,
  );

  it("P3 (bounded proxy): emissions are capped per window while every refusal counts", async () => {
    // The soak's invariant, driven directly so it is checked on every run.
    const { createContentionTracker } = await import("../pi/bridge-contention.js");
    const clock = { t: 0 };
    const tracker = createContentionTracker(() => clock.t);

    let emissions = 0;
    const attempts = 600; // 5 min of a bridge retrying twice a second
    for (let i = 0; i < attempts; i++) {
      clock.t = i * 500;
      if (tracker.record("S")) emissions++;
    }

    const elapsed = attempts * 500;
    expect(tracker.count()).toBe(attempts);
    expect(emissions).toBeLessThanOrEqual(Math.ceil(elapsed / CONTENTION_RATE_LIMIT) + 1);
    expect(tracker.contendedIds()).toEqual(["S"]);
  }, 30000);
});
