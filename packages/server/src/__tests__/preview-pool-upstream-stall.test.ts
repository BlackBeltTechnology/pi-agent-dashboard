/**
 * An upstream that never answers (D5, parity with `/live/` and `/preview/<pid>/`): every door inherits the one proxy
 * timeout (`forwardPort` → `@fastify/reply-from` → undici `headersTimeout`, 300 s by default); a stalled request never blocks
 * another request on the same listener; the proxied hop is released no later than that timeout. No new timeout value is introduced (A5).
 *
 * SCALED: 300 s is not waitable in a test, so `@fastify/reply-from` is registered through a wrapper that sets the undici
 * `headersTimeout` to STALL_TIMEOUT_MS for EVERY door alike (pool listener, `/preview/<pid>/`, `/live/`). The assertions are parity
 * between the doors and "bounded by the timeout", never the 300 s value itself.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #X15).
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveCapabilityHook } from "../live-server/live-capability.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createHarness, type Harness, hop, request, session } from "./preview-pool-harness.js";

const STALL_TIMEOUT_MS = 1500;
vi.mock("@fastify/reply-from", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fastify/reply-from")>();
  const real = actual.default as unknown as (...a: unknown[]) => unknown;
  const wrapped = (fastify: unknown, opts: Record<string, unknown>, done: unknown) =>
    real(fastify, { ...opts, undici: { headersTimeout: 1500, bodyTimeout: 1500 } }, done);
  Object.assign(wrapped, real); // fastify-plugin metadata (skip-override, name) must survive
  return { ...actual, default: wrapped };
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const pol = { egress: "restricted", scripts: false } as const;

/** The three doors onto one stalling upstream: a pool listener, `/preview/<pid>/`, and the legacy `/live/<id>/~c/<token>/`. */
async function setup() {
  const h: Harness = await createHarness({ n: 3 });
  cleanups.push(() => h.close());
  const paths = new PreviewPathStore();
  const app: FastifyInstance = Fastify({ logger: false });
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createLiveCapabilityHook(h.store, paths));
  registerLiveServerProxy(app, h.manager);
  await app.listen({ port: 0, host: "127.0.0.1" });
  cleanups.push(() => app.close());
  const appPort = (app.server.address() as AddressInfo).port;
  const pid = paths.mint("t1", { kind: "local" }, { policy: pol });
  if (!pid.ok) throw new Error("preview mint");
  const legacy = h.store.mint("t1", { kind: "local" });
  const pm = await h.mint(session("s1"));
  if (!pm.ok) throw new Error("pool mint");
  const cookie = await hop(pm.port, pm.k, "s1");
  const doors = {
    pool: { name: "pool listener", send: (path: string, o: { timeoutMs?: number } = {}) => request(pm.port, path, { cookie, ...o }), start: (path: string) => startRaw(pm.port, path, { cookie, host: `127.0.0.1:${pm.port}` }) },
    preview: { name: "/preview/<pid>/", send: (path: string, o: { timeoutMs?: number } = {}) => viaApp(appPort, `/preview/${pid.pid}${path}`, o), start: (path: string) => startRaw(appPort, `/preview/${pid.pid}${path}`, {}) },
    live: { name: "/live/<id>/~c/<token>/", send: (path: string, o: { timeoutMs?: number } = {}) => viaApp(appPort, `/live/t1/~c/${legacy.token}${path}`, o), start: (path: string) => startRaw(appPort, `/live/t1/~c/${legacy.token}${path}`, {}) },
  };
  return { h, doors };
}

const viaApp = (port: number, path: string, o: { timeoutMs?: number } = {}) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path, agent: false, timeout: o.timeoutMs }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    r.on("error", reject);
    r.end();
  });

/** A request the caller can abort. */
function startRaw(port: number, path: string, o: { cookie?: string; host?: string }) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = o.cookie;
  if (o.host) headers.host = o.host;
  const req = http.request({ host: "127.0.0.1", port, path, headers, setHost: o.host === undefined, agent: false });
  const done = new Promise<{ status: number } | "aborted">((resolve) => {
    req.on("response", (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", () => resolve("aborted"));
  });
  req.end();
  return { abort: () => req.destroy(), done };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms: number): Promise<boolean> {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    if (cond()) return true;
    await sleep(20);
  }
  return cond();
}

describe("T.X15 — upstream stalls its response headers", () => {
  it("every door answers 504 at the same inherited proxy timeout, while other requests on the same listener are served", async () => {
    const { h, doors } = await setup();
    const t0 = Date.now();
    const stalled = (Object.values(doors) as (typeof doors)[keyof typeof doors][]).map((d) => d.send("/stall").then((r) => ({ name: d.name, ...r, at: Date.now() - t0 })));
    expect(await until(() => h.upstream.stalled.length === 3, 3000)).toBe(true); // all three reached the upstream and sit there

    // Not blocked: each door still serves a normal request promptly while the stalled ones are pending.
    for (const d of Object.values(doors)) {
      const t1 = Date.now();
      const ok = await d.send("/ok");
      expect(ok.status, d.name).toBe(200);
      expect(ok.body, d.name).toBe("upstream-body");
      expect(Date.now() - t1, d.name).toBeLessThan(1500);
    }
    // ...and a second concurrent stall plus a burst of fast ones on the SAME pool listener
    const burst = await Promise.all(Array.from({ length: 20 }, () => doors.pool.send("/ok")));
    expect(burst.every((r) => r.status === 200)).toBe(true);

    const results = await Promise.all(stalled);
    for (const r of results) expect(r.status, `${r.name}: ${r.body}`).toBe(504); // the existing proxy timeout answer
    const times = results.map((r) => r.at);
    // One inherited timeout (A5): asserted as parity across the doors and as "at the timeout", not as a new value.
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(800);
    for (const t of times) {
      expect(t).toBeGreaterThanOrEqual(STALL_TIMEOUT_MS - 100);
      expect(t).toBeLessThan(STALL_TIMEOUT_MS + 2500);
    }
    expect(results.find((r) => r.name === "pool listener")?.body).toContain("gateway_timeout");
  }, 60_000);

  it("a client abort never wedges the listener: the proxied hop is released by the same timeout on every door, and the door keeps serving", async () => {
    const { h, doors } = await setup();
    for (const d of Object.values(doors)) {
      const before = h.upstream.stalled.length;
      const call = d.start("/stall");
      expect(await until(() => h.upstream.stalled.length === before + 1, 3000), d.name).toBe(true);
      const upstreamReq = h.upstream.stalled[before];
      call.abort();
      expect(await call.done).toBe("aborted");
      // Not blocked by the abandoned request:
      const ok = await d.send("/ok");
      expect([ok.status, ok.body], d.name).toEqual([200, "upstream-body"]);
      // The abandoned hop ends no later than the inherited timeout (same on every door).
      const t0 = Date.now();
      expect(await until(() => upstreamReq.socket.destroyed, STALL_TIMEOUT_MS + 2500), `${d.name}: abandoned hop never released`).toBe(true);
      expect(Date.now() - t0, d.name).toBeLessThan(STALL_TIMEOUT_MS + 2500);
    }
  }, 60_000);
});
