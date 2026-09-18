/**
 * Route-level proof that a lock-contended credential write (a) surfaces its
 * lock reason instead of Fastify's generic 500 and (b) never blocks the event
 * loop while it waits (test-plan X1, P1, P2).
 *
 * Uses the REAL storage module and the REAL route — `provider-auth-routes.test.ts`
 * mocks the storage module wholesale, which would make these rows vacuous
 * (same rationale as `provider-auth-routes-corrupt.test.ts`).
 *
 * The `/api/health` handler here is a minimal stand-in for the real one: the
 * assertion under test is that the WAITING WRITE yields the event loop, not
 * what health's payload contains, so the instrument is deliberately small and
 * cannot itself be the reason a probe is slow.
 *
 * See change: fix-provider-auth-lock-contention.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import Fastify from "fastify";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

const _require = createRequire(import.meta.url);
const lockfile = _require("proper-lockfile") as typeof import("proper-lockfile");

const HOLD_OPTIONS = { stale: 10_000, realpath: false } as const;

const AUTH_DIR = path.join(os.homedir(), ".pi", "agent");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");
const LOCK_PATH = `${AUTH_PATH}.lock`;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ascending p95 (nearest-rank) of a latency sample. */
function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

async function holdLock(ms: number): Promise<() => Promise<void>> {
  const release = await lockfile.lock(AUTH_PATH, HOLD_OPTIONS);
  const acquired = Date.now();
  return () => sleep(Math.max(0, ms - (Date.now() - acquired))).then(() => release());
}

function createMockPiGateway() {
  return {
    broadcast: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    connectionCount: () => 0,
    findSessionByCwd: () => undefined,
    getConnectedSessionIds: () => [],
    isSessionConnected: () => false,
  } as any;
}

describe("provider-auth routes under lock contention", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    for (const p of [AUTH_PATH, LOCK_PATH]) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* absent */ }
    }
    app = Fastify();
    registerProviderAuthRoutes(app, {
      piGateway: createMockPiGateway(),
      browserGateway: { broadcastToAll: vi.fn() } as any,
    });
    // Minimal, always-fast probe — see the file header.
    app.get("/api/health", async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    for (const p of [AUTH_PATH, LOCK_PATH]) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* absent */ }
    }
  });

  // #X1
  it("DELETE reports the lock reason instead of the generic 500", async () => {
    fs.writeFileSync(
      AUTH_PATH,
      JSON.stringify({ anthropic: { type: "oauth", refresh: "r", access: "sk-SECRETLOCK", expires: 1 } }) + "\n",
      { mode: 0o600 },
    );

    const release = await holdLock(3_000);
    let res: Awaited<ReturnType<typeof app.inject>>;
    try {
      res = await app.inject({ method: "DELETE", url: "/api/provider-auth/anthropic" });
    } finally {
      await release();
    }

    expect(res.statusCode).toBe(500);
    const body = res.json() as { error?: string };
    expect(body.error).toMatch(/lock/i);
    expect(body.error).not.toBe("Internal Server Error");
    expect(JSON.stringify(body)).not.toContain("sk-SECRETLOCK");
  }, 15_000);

  // #P1
  it("keeps answering /api/health while a DELETE waits for the lock", async () => {
    fs.writeFileSync(AUTH_PATH, "{}\n", { mode: 0o600 });
    const release = await holdLock(1_500);

    let deleteSettled = false;
    const started = Date.now();
    const pending = app
      .inject({ method: "DELETE", url: "/api/provider-auth/anthropic" })
      .finally(() => { deleteSettled = true; });

    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const probeStarted = Date.now();
      const health = await app.inject({ method: "GET", url: "/api/health" });
      latencies.push(Date.now() - probeStarted);
      expect(health.statusCode).toBe(200);
    }

    // Every probe above was answered while the DELETE was still waiting.
    expect(deleteSettled).toBe(false);

    await release();
    const res = await pending;
    expect(res.statusCode).toBe(200);
    // ...and the DELETE really did wait for the holder rather than winning outright.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_200);

    expect(p95(latencies)).toBeLessThan(200);
  }, 15_000);

  // #P2
  it("does not serialize concurrent writes into a stall", async () => {
    fs.writeFileSync(AUTH_PATH, "{}\n", { mode: 0o600 });
    const release = await holdLock(500);

    const started = Date.now();
    const writes = Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: "PUT",
          url: "/api/provider-auth/api-key",
          payload: { provider: `p2-${i}`, key: `sk-p2-${i}-000000000` },
        }),
      ),
    );

    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = Date.now();
      const health = await app.inject({ method: "GET", url: "/api/health" });
      latencies.push(Date.now() - t);
      expect(health.statusCode).toBe(200);
    }

    await release();
    const results = await writes;
    const wall = Date.now() - started;

    for (const r of results) expect(r.statusCode).toBe(200);
    expect(wall).toBeLessThan(2_000);
    expect(p95(latencies)).toBeLessThan(200);
    expect(Object.keys(JSON.parse(fs.readFileSync(AUTH_PATH, "utf-8"))).sort()).toEqual([
      "p2-0", "p2-1", "p2-2", "p2-3", "p2-4",
    ]);
  }, 15_000);
});
