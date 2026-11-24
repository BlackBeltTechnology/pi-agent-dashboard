/**
 * Probe flood on unknown labels (D13, Q48): 10,000 requests with distinct random `<L>.localhost:8000` Hosts from one peer
 * through the REAL dispatcher on a real socket. The refusal log obeys the host gate's limiter semantics (one line per host per
 * 60 s window, ≤ 256 tracked hosts — behavioural parity with `HostGateState`), `GET /api/host-gate` `recent` is unchanged, every
 * probe is the same opaque 403, and the dashboard stays responsive.
 *
 * SCALED: the 10 s flood runs as fast as the loopback allows (~seconds) and the "60 s observe" is a fake clock the observer reads.
 * RECORDED, not asserted: heap delta, and the 1.5x `/api/health` p95 ratio (a wall-clock ratio is not a deterministic assertion;
 * only a loose liveness bound is asserted).
 *
 * See change: serve-live-previews-on-capability-origin (D13; test-plan #P3).
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { HostGateState } from "../auth/host-gate.js";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";
import { createPreviewObserver, MAX_TRACKED, REFUSE_WINDOW_MS } from "../live-server/preview-observe.js";
import { registerHostGateRoutes } from "../routes/host-gate-routes.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const randomLabel = (): string => Array.from(crypto.randomBytes(26), (b) => BASE32[b & 31]).join("");
const FLOOD = 10_000;
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });

function get(port: number, host: string, urlPath = "/"): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host }, setHost: false, agent }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", () => resolve({ status: 0, body: "" }));
    req.end();
  });
}
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)] ?? 0;

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe("T.P3 / #P3 — probe flood on unknown labels", () => {
  it("10k distinct random labels: one opaque 403 each, ≤ 1 refuse line per host per window, tracked ≤ 256, host-gate recent unchanged, dashboard alive", async () => {
    const lines: string[] = [];
    let clock = 1_000_000;
    const observer = createPreviewObserver({ sink: (l) => lines.push(l), now: () => clock });
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    const manager = { get: () => undefined, getStatic: () => undefined, has: () => false, use: () => {}, list: () => [] } as unknown as LiveServerManager;
    const dispatch = createPreviewDispatch({ store, manager, isPeerLocal: () => true, onRefused: (r, h) => observer.refused(r, h), onAdmitted: (h, t) => observer.admitted(h, t) });
    const app: FastifyInstance = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    const gateState = new HostGateState();
    app.get("/api/health", async () => ({ ok: true }));
    registerHostGateRoutes(app, { networkGuard: async () => undefined, state: gateState, getCtx: () => ({ admission: { livePreviewEnabled: () => true }, mode: "enforce", envOverridden: false }) });
    await dispatch.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const conns = new Set<Socket>();
    app.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
    stop = async () => {
      agent.destroy();
      for (const s of conns) s.destroy();
      await app.close();
      await dispatch.close();
      store.close();
    };
    const port = (app.server.address() as AddressInfo).port;
    const dash = `localhost:${port}`;
    const recent = async () => JSON.parse((await get(port, dash, "/api/host-gate")).body).recent as unknown[];
    const timeHealth = async (n: number): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        const r = await get(port, dash, "/api/health");
        expect(r.status).toBe(200);
        out.push(performance.now() - t);
      }
      return out;
    };

    // ---- idle baseline
    const idle = await timeHealth(40);
    const recentBefore = await recent();
    expect(recentBefore).toEqual([]);
    const heapBefore = process.memoryUsage().heapUsed;

    // ---- the flood: 10,000 distinct random labels from one peer, 48 in flight; /api/health sampled alongside
    const labels = Array.from({ length: FLOOD }, randomLabel);
    expect(new Set(labels).size).toBe(FLOOD);
    const statuses = new Map<number, number>();
    const bodies = new Set<string>();
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= FLOOD) return;
        const r = await get(port, `${labels[i]}.localhost:8000`, i % 3 === 0 ? "/" : "/api/health");
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
        bodies.add(r.body);
      }
    };
    let flooding = true;
    const during: number[] = [];
    const sampler = (async () => {
      while (flooding) {
        const t = performance.now();
        const r = await get(port, dash, "/api/health");
        if (r.status === 200) during.push(performance.now() - t);
        await new Promise((res) => setTimeout(res, 10));
      }
    })();
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 48 }, worker));
    flooding = false;
    await sampler;
    const floodSec = (Date.now() - t0) / 1000;

    // every probe: the same opaque 403, never the dashboard's /api/health, never a 5xx
    expect(statuses.get(403)).toBe(FLOOD);
    expect([...statuses.keys()]).toEqual([403]);
    expect([...bodies]).toEqual(['{"error":"host_not_allowed"}']);

    // refusal log: exactly one line per distinct host (each host is its own key), none duplicated, all redacted
    const refuse = lines.filter((l) => l.startsWith("[live-preview] refuse "));
    expect(refuse).toHaveLength(FLOOD);
    expect(new Set(refuse).size).toBe(FLOOD);
    for (const l of refuse) expect(l).toMatch(/^\[live-preview\] refuse h=[0-9a-f]{8} reason=unknown$/);
    for (const l of lines) for (const label of labels.slice(0, 200)) expect(l).not.toContain(label);
    // …while the limiter's tracked state is bounded at the host gate's cap
    expect(MAX_TRACKED).toBe(256);
    expect(REFUSE_WINDOW_MS).toBe(60_000);
    expect(observer.size().refuse).toBeLessThanOrEqual(256);
    expect(observer.size().admit).toBe(0);

    // repeat probes of the SAME hosts inside the window: counted, never logged again (the limiter's 1 line / host / 60 s)
    const linesBefore = lines.length;
    const tail = labels.slice(-100); // the most recently tracked hosts
    for (let round = 0; round < 5; round++) await Promise.all(tail.map((l) => get(port, `${l}.localhost:8000`)));
    expect(lines.length).toBe(linesBefore);
    // …and once the window has rolled they log again, once each
    clock += REFUSE_WINDOW_MS;
    for (let round = 0; round < 5; round++) await Promise.all(tail.map((l) => get(port, `${l}.localhost:8000`)));
    expect(lines.length - linesBefore).toBe(tail.length);

    // `GET /api/host-gate` recent is unchanged by the whole flood (refusals never enter the ring) and no label leaks into it
    expect(await recent()).toEqual(recentBefore);
    expect(gateState.recent()).toEqual([]);
    const gateBody = (await get(port, dash, "/api/host-gate")).body;
    for (const label of labels.slice(0, 200)) expect(gateBody).not.toContain(label);

    // dashboard liveness: the flood never stalled /api/health (loose bound; the 1.5x p95 ratio is recorded below, not asserted)
    expect(during.length).toBeGreaterThan(0);
    const idleP95 = p95(idle);
    const floodP95 = p95(during);
    expect(floodP95).toBeLessThan(Math.max(idleP95 * 20, 1_000));
    const after = await timeHealth(20); // and it recovers once the flood is over
    expect(p95(after)).toBeLessThan(Math.max(idleP95 * 20, 1_000));
    console.info(
      `[P3] flood ${FLOOD} req in ${floodSec.toFixed(1)} s; /api/health p95 idle ${idleP95.toFixed(1)} ms, during ${floodP95.toFixed(1)} ms (ratio ${(floodP95 / Math.max(idleP95, 0.01)).toFixed(2)}), heap delta ${Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024)} KiB (recorded, not asserted)`,
    );
  }, 180_000);
});
