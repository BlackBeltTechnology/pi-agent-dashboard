/**
 * Heartbeat ingest of the new heap/GC `ProcessMetrics` fields.
 *
 * The compatibility contract is bidirectional and the reason all six fields are
 * optional: an OLD bridge against a NEW server sends none of them, and a NEW
 * bridge against an OLD server sends fields it ignores. Neither side parses
 * strictly, so the only thing that can break this is coercion — an absent field
 * turning into `0`, which reads as "the ceiling is zero" / "no GC happened"
 * rather than "nobody reported".
 *
 * Structure follows `pi-gateway-host-pressure.test.ts` (real socket, real
 * gateway, real session manager).
 *
 * See change: bound-session-heap-and-gc-telemetry (test-plan #E16).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

let tmp: string;
let sockPath: string;
let gateway: ReturnType<typeof createPiGateway> | null = null;
const sockets: WebSocket[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-heap-"));
  sockPath = path.join(tmp, "gateway-9998.sock");
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

const BASE = { rss: 1, heapUsed: 2, heapTotal: 3, cpuPercent: 0, loadAvg1m: 0 };

async function ingest(
  sessionId: string,
  metrics: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionManager = createMemorySessionManager();
  gateway = createPiGateway(sessionManager, { pingInterval: 0 });
  await gateway.startOnSocket(sockPath);

  const ws = new WebSocket(`ws+unix://${sockPath}:/`);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: tmp, pid: process.pid }));
  await waitFor(() => gateway?.isSessionConnected(sessionId) === true);

  ws.send(JSON.stringify({ type: "session_heartbeat", sessionId, metrics }));
  await waitFor(
    () => sessionManager.get(sessionId)?.processMetrics !== undefined,
  );
  return (sessionManager.get(sessionId)?.processMetrics ?? {}) as Record<string, unknown>;
}

describe("heartbeat ingest of heap/GC metrics (test-plan #E16)", () => {
  it("accepts a heartbeat carrying ALL the new fields", async () => {
    const stored = await ingest("heap-all", {
      ...BASE,
      heapSizeLimit: 700_000_000,
      external: 1_000,
      arrayBuffers: 500,
      gcCount: 7,
      gcMajorCount: 2,
      gcPauseMsTotal: 12.5,
    });
    expect(stored.heapSizeLimit).toBe(700_000_000);
    expect(stored.external).toBe(1_000);
    expect(stored.arrayBuffers).toBe(500);
    expect(stored.gcCount).toBe(7);
    expect(stored.gcMajorCount).toBe(2);
    expect(stored.gcPauseMsTotal).toBe(12.5);
  });

  it("accepts a heartbeat carrying NONE of them — an old bridge still works", async () => {
    const stored = await ingest("heap-none", { ...BASE });
    expect(stored.rss).toBe(1);
    for (const f of ["heapSizeLimit", "external", "arrayBuffers", "gcCount", "gcMajorCount"]) {
      // ABSENT, never coerced to `0`: `gcMajorCount: 0` claims "no major GC",
      // which is a different statement from "this bridge does not report it".
      expect(stored[f]).toBeUndefined();
    }
  });

  it("accepts a SUBSET and leaves the rest absent", async () => {
    const stored = await ingest("heap-subset", { ...BASE, heapSizeLimit: 512, gcMajorCount: 3 });
    expect(stored.heapSizeLimit).toBe(512);
    expect(stored.gcMajorCount).toBe(3);
    expect(stored.gcCount).toBeUndefined();
    expect(stored.external).toBeUndefined();
  });
});
