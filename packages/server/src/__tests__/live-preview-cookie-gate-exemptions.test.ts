/**
 * The duplicate-cookie gate (400, self-healing) guards the DASHBOARD only (D10). previewApp (own Fastify instance) and the
 * pool listeners are exempt by construction:
 *   - previewApp, tier 1: `pi_dash_token` ×2 → forwarded, the upstream sees no `pi_dash_*`, no 400, no Set-Cookie expiry;
 *   - pool listener: `pi_dash_pool_<port>` ×2 → 404 with nothing forwarded (never 400).
 * The control leg proves the gate really is on the dashboard side of the same listener.
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #E121).
 */
import http from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createDuplicateCookieGate } from "../auth/duplicate-cookie-gate.js";
import { type CapabilityPrincipal, LiveCapabilityStore, principalKeyOf, sessionKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";
import { createPreviewPool } from "../live-server/preview-pool.js";

const SESSION = "session-cookie-value";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Seen {
  url: string;
  cookie?: string;
}
interface Res {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}
function req(port: number, host: string, headers: Record<string, string>, urlPath = "/page"): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host, ...headers }, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
}

async function startUpstream(seen: Seen[]): Promise<number> {
  const upstream = http.createServer((r, res) => {
    seen.push({ url: r.url ?? "", cookie: r.headers.cookie });
    res.end("upstream-body");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  cleanups.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));
  return (upstream.address() as AddressInfo).port;
}
const managerFor = (port: number) =>
  ({
    get: (id: string) => (id === "t1" ? { id, label: id, host: "127.0.0.1", port } : undefined),
    getStatic: () => undefined,
    has: (id: string) => id === "t1",
    use: () => {},
    list: () => [],
  }) as unknown as LiveServerManager;

describe("T.E121 / #E121 — duplicate-cookie gate: previewApp and pool exemptions", () => {
  it("previewApp (tier 1): `pi_dash_token` ×2 is forwarded with every pi_dash_* stripped — no 400, no Set-Cookie expiry; the dashboard side of the SAME listener answers 400", async () => {
    const seen: Seen[] = [];
    const manager = managerFor(await startUpstream(seen));
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    const dispatch = createPreviewDispatch({ store, manager, isPeerLocal: () => true });
    const front: FastifyInstance = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    front.addHook("onRequest", createDuplicateCookieGate({ log: undefined, tier2: () => false }));
    front.get("/page", async () => "dashboard");
    await dispatch.ready();
    await front.listen({ port: 0, host: "127.0.0.1" });
    const conns = new Set<Socket>();
    front.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
    cleanups.push(async () => {
      for (const s of conns) s.destroy();
      await front.close();
      await dispatch.close();
      store.close();
    });
    const port = (front.server.address() as AddressInfo).port;
    const m = store.mint("t1", { kind: "local" }, { preview: { tier: 1, ancestors: ["http://localhost:8000"], buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }) } });

    // control: the dashboard (non-preview Host) refuses the duplicate with a self-healing 400
    const dash = await req(port, `localhost:${port}`, { cookie: "pi_dash_token=a; pi_dash_token=b" });
    expect(dash.status).toBe(400);
    expect(JSON.parse(dash.body)).toMatchObject({ error: "duplicate_dashboard_cookie" });
    expect(dash.headers["set-cookie"]).toBeDefined();
    expect(seen).toEqual([]);

    // previewApp: same duplicate, label Host
    const cookie = "pi_dash_token=a; pi_dash_token=b; pi_dash_device=x; pi_dash_device=y; app=1";
    const res = await req(port, `${m.token}.localhost:8000`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body).toBe("upstream-body");
    expect(res.headers["set-cookie"]).toBeUndefined(); // no expiry lines, no cookie at all
    expect(seen).toHaveLength(1);
    expect(seen[0].cookie).toBe("app=1"); // the upstream sees no pi_dash_* (all four stripped), the app's own cookie passes
    expect(seen[0].cookie ?? "").not.toMatch(/pi_dash_/);

    // an app that itself sends two cookies of one NON-dashboard name is untouched by the gate
    const other = await req(port, `${m.token}.localhost:8000`, { cookie: "app=1; app=2" });
    expect(other.status).toBe(200);
    expect(seen[1].cookie).toBe("app=1; app=2");
  });

  it("pool listener: `pi_dash_pool_<port>` ×2 (and a duplicated session cookie) → 404, nothing forwarded, never a 400 or a Set-Cookie", async () => {
    const seen: Seen[] = [];
    const upstreamPort = await startUpstream(seen);
    const manager = managerFor(upstreamPort);
    // one free loopback port as a one-port pool
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const poolPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const range = { from: poolPort, to: poolPort };
    let pool!: ReturnType<typeof createPreviewPool>;
    const store = new LiveCapabilityStore({ isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r) });
    pool = createPreviewPool({
      range: () => range,
      bindHost: () => "127.0.0.1",
      findByPoolPort: (p) => store.findByPoolPort(p),
      revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
      touch: (g) => void store.touch(g.tokenId, g.minterKey),
      manager,
      log: () => {},
    });
    cleanups.push(async () => {
      store.close();
      await pool.close();
    });
    const principal: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: sessionKeyOf(SESSION) };
    const a = await pool.allocate(principalKeyOf(principal), "127.0.0.1");
    if (!a.ok) throw new Error("pool allocate");
    store.mint("t1", principal, { preview: { tier: 3, ancestors: ["http://127.0.0.1:8000"], fixed: { origin: a.origin, originHost: a.originHost, poolPort: a.port } } });
    const k = pool.issueK(a.port) as string;
    const host = `127.0.0.1:${a.port}`;

    // the first-navigation hop works (so the listener is genuinely live and admitting)
    const hop = await req(a.port, host, { cookie: `pi_dash_token=${SESSION}` }, `/?k=${k}`);
    expect(hop.status).toBe(302);
    const poolCookie = ([] as string[]).concat(hop.headers["set-cookie"] ?? [])[0].split(";")[0]; // pi_dash_pool_<port>=<v>
    expect(poolCookie).toMatch(new RegExp(`^pi_dash_pool_${a.port}=`));

    // control: the valid single cookies are served
    const ok = await req(a.port, host, { cookie: `pi_dash_token=${SESSION}; ${poolCookie}` }, "/page");
    expect(ok.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].cookie ?? "").not.toMatch(/pi_dash_/);

    // duplicates: 404 (not 400), nothing forwarded, nothing set
    const attempts = [
      `pi_dash_token=${SESSION}; ${poolCookie}; ${poolCookie}`,
      `pi_dash_token=${SESSION}; ${poolCookie}; pi_dash_pool_${a.port}=other`,
      `pi_dash_token=${SESSION}; pi_dash_token=${SESSION}; ${poolCookie}`,
      `pi_dash_pool_${a.port}=a; pi_dash_pool_${a.port}=b`,
    ];
    for (const cookie of attempts) {
      const r = await req(a.port, host, { cookie }, "/page");
      expect(r.status, cookie).toBe(404);
      expect(r.status, cookie).not.toBe(400);
      expect(r.headers["set-cookie"], cookie).toBeUndefined();
    }
    expect(seen).toHaveLength(1); // nothing from the duplicate attempts reached the upstream
  });
});
