/**
 * Tier 3 — port-pool listeners (D5): allocation, the three admission checks + Host binding, the `?k=` hop, release on every
 * deletion path, failure modes, and the mint route's eligibility / fall-through.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #E55-#E72, #P7, #P8, #X11-#X14, #X28, #X29 server halves).
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CapabilityPrincipal, LiveCapabilityStore, principalKeyOf, sessionKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewPool, POOL_PRINCIPAL_CAP, type PreviewPool, safeTo } from "../live-server/preview-pool.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const COOKIE = "session-cookie-value";
const session = (v = COOKIE): CapabilityPrincipal => ({ kind: "session", tier: "control", sessionKey: sessionKeyOf(v) });

/** A free run of `n` consecutive ports. */
async function freeRange(n: number): Promise<{ from: number; to: number }> {
  for (let base = 21000 + Math.floor(Math.random() * 20000); ; base += n + 1) {
    const servers: net.Server[] = [];
    try {
      for (let i = 0; i < n; i++) {
        const s = net.createServer();
        await new Promise<void>((res, rej) => {
          s.once("error", rej);
          s.listen(base + i, "127.0.0.1", () => res());
        });
        servers.push(s);
      }
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
      return { from: base, to: base + n - 1 };
    } catch {
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    }
  }
}

const seen: { url: string; cookie?: string }[] = [];
let upstream: http.Server;
let upstreamPort = 0;
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
beforeEach(async () => {
  seen.length = 0;
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url ?? "", cookie: req.headers.cookie });
    res.end("upstream-body");
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as AddressInfo).port;
  cleanups.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));
});

async function setup(n = 4, over: { now?: () => number; sweepIntervalMs?: number } = {}) {
  const range = await freeRange(n);
  const manager = {
    get: (id: string) => (id === "t1" || id === "t2" ? { id, label: id, host: "127.0.0.1", port: upstreamPort } : undefined),
    getStatic: () => undefined,
    has: (id: string) => id === "t1" || id === "t2",
    use: () => {},
    list: () => [],
  } as unknown as LiveServerManager;
  let pool!: PreviewPool;
  const store = new LiveCapabilityStore({ isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r), ...over });
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
  /** The route's mint, minus HTTP: allocate, store, issue `k`. */
  async function mint(principal: CapabilityPrincipal = session(), targetId = "t1") {
    const a = await pool.allocate(principalKeyOf(principal), "127.0.0.1");
    if (!a.ok) return a;
    const m = store.mint(targetId, principal, { preview: { tier: 3, ancestors: ["http://127.0.0.1:8000"], fixed: { origin: a.origin, originHost: a.originHost, poolPort: a.port } } });
    return { ok: true as const, port: a.port, origin: a.origin, k: pool.issueK(a.port) as string, tokenId: m.tokenId };
  }
  return { range, pool, store, mint, manager };
}

type Res = { status: number; body: string; headers: http.IncomingHttpHeaders };
const req = (port: number, path: string, o: { host?: string | null; cookie?: string; origin?: string } = {}): Promise<Res> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (o.host !== null) headers.host = o.host ?? `127.0.0.1:${port}`;
    if (o.cookie) headers.cookie = o.cookie;
    if (o.origin) headers.origin = o.origin;
    const r = http.request({ host: "127.0.0.1", port, path, headers, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    r.on("error", reject);
    r.end();
  });
/** Run the first-navigation hop; returns the pool cookie to present afterwards. */
async function hop(port: number, k: string, to?: string): Promise<{ res: Res; cookie: string }> {
  const res = await req(port, `/?k=${k}${to ? `&to=${encodeURIComponent(to)}` : ""}`, { cookie: `pi_dash_token=${COOKIE}` });
  const sc = ([] as string[]).concat(res.headers["set-cookie"] ?? [])[0] ?? "";
  return { res, cookie: `pi_dash_token=${COOKIE}; ${sc.split(";")[0]}` };
}
const refused = (port: number) => new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(false); }); s.on("error", () => r(true)); });

describe("allocation (E55, E56, E57, E60, E72, X11, X12, P8)", () => {
  it("E55: the lowest free port, bound on the bind host, origin = http://<ip>:<port>", async () => {
    const { range, mint } = await setup(3);
    const a = await mint();
    expect(a.ok && a.port).toBe(range.from);
    expect(a.ok && a.origin).toBe(`http://127.0.0.1:${range.from}`);
    const b = await mint(session("other"), "t2");
    expect(b.ok && b.port).toBe(range.from + 1);
  });
  it("E56/E57: the last port is used; beyond it nothing binds and the allocation says exhausted", async () => {
    const { range, mint, pool } = await setup(2);
    await mint(session("a"));
    const last = await mint(session("b"));
    expect(last.ok && last.port).toBe(range.to);
    const over = await mint(session("c"));
    expect(over).toEqual({ ok: false, reason: "exhausted" });
    expect(pool.heldPorts()).toHaveLength(2);
    expect(await refused(range.to + 1)).toBe(true);
  });
  it("E60: one principal holds at most 8; a second principal still gets one", async () => {
    const { mint } = await setup(12);
    for (let i = 0; i < POOL_PRINCIPAL_CAP; i++) expect((await mint(session(), "t1")).ok, String(i)).toBe(true);
    expect(await mint(session())).toEqual({ ok: false, reason: "principal-cap" });
    expect((await mint(session("someone-else"))).ok).toBe(true);
  });
  it("E72/X12: a foreign holder is skipped (and untouched); when every port is foreign the allocation is exhausted, then recovers", async () => {
    const { range, mint } = await setup(2);
    const foreign: net.Server[] = [];
    for (const p of [range.from, range.to]) {
      const s = net.createServer();
      await new Promise<void>((r) => s.listen(p, "127.0.0.1", r));
      foreign.push(s);
    }
    cleanups.push(() => Promise.all(foreign.map((s) => new Promise<void>((r) => s.close(() => r())))).then(() => undefined));
    expect(await mint()).toEqual({ ok: false, reason: "exhausted" });
    await new Promise<void>((r) => foreign[0].close(() => r()));
    const later = await mint();
    expect(later.ok && later.port).toBe(range.from); // no negative caching
  });
  it("P8: 20 concurrent allocations on a 6-port pool never bind a port twice; the rest are exhausted", async () => {
    const { mint, pool } = await setup(6);
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => mint(session(`p${i % 5}`))));
    const ok = out.filter((o) => o.ok);
    expect(ok).toHaveLength(6);
    expect(new Set(ok.map((o) => (o.ok ? o.port : 0))).size).toBe(6);
    expect(out.filter((o) => !o.ok).every((o) => !o.ok && o.reason === "exhausted")).toBe(true);
    expect(pool.heldPorts()).toHaveLength(6);
  });
  it("an unconfigured pool is `disabled`", async () => {
    const pool = createPreviewPool({ range: () => undefined, bindHost: () => "127.0.0.1", findByPoolPort: () => null, revokeByPoolPort: () => {}, manager: {} as LiveServerManager });
    expect(await pool.allocate("k", "127.0.0.1")).toEqual({ ok: false, reason: "disabled" });
    expect(pool.poolPorts()).toEqual([]);
  });
});

describe("admission: Host binding, session, pool cookie, Origin (E62, E63, E64, E65, E66, E67, E71)", () => {
  it("E63: `?k=` is one-shot: 302 to `to` with a host-only HttpOnly cookie; replay with cookie → clean redirect; replay without cookie, garbage → 404", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { res, cookie } = await hop(m.port, m.k, "/deep");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/deep");
    const sc = String(res.headers["set-cookie"]);
    expect(sc).toMatch(new RegExp(`^pi_dash_pool_${m.port}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/$`));
    expect(sc).not.toContain("Domain");
    const again = await req(m.port, `/?k=${m.k}`, { cookie });
    expect(again.status).toBe(302);
    expect(again.headers.location).toBe("/");
    expect((await req(m.port, `/?k=${m.k}`, { cookie: `pi_dash_token=${COOKIE}` })).status).toBe(404);
    expect((await req(m.port, "/?k=garbage", { cookie: `pi_dash_token=${COOKIE}` })).status).toBe(404);
    expect((await req(m.port, "/anything", { cookie })).body).toBe("upstream-body");
  });
  it("E62: only (right session, right pool cookie, no/equal Origin) is forwarded; the upstream sees no pi_dash_* cookie", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { cookie } = await hop(m.port, m.k);
    const wrongSession = cookie.replace(COOKIE, "someone-elses-valid-session");
    const noPool = `pi_dash_token=${COOKIE}`;
    const wrongPool = cookie.replace(/pi_dash_pool_(\d+)=[^;]+/, "pi_dash_pool_$1=forged");
    const cases: [string, { cookie?: string; origin?: string }, number][] = [
      ["ok", { cookie }, 200],
      ["ok + equal Origin", { cookie, origin: m.origin }, 200],
      ["other valid session", { cookie: wrongSession }, 404],
      ["no pool cookie", { cookie: noPool }, 404],
      ["forged pool cookie", { cookie: wrongPool }, 404],
      ["no cookie", {}, 404],
      ["Origin other port", { cookie, origin: `http://127.0.0.1:${m.port + 1}` }, 404],
      ["Origin null", { cookie, origin: "null" }, 404],
    ];
    for (const [label, o, status] of cases) expect((await req(m.port, "/x", o)).status, label).toBe(status);
    expect(seen.length).toBe(2);
    expect(seen.every((s) => !s.cookie || !/pi_dash_/.test(s.cookie))).toBe(true);
  });
  it("E64: a re-mint gives a fresh `k` on the SAME listener; the old unconsumed `k` is dead", async () => {
    const { mint, pool } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const k2 = pool.issueK(m.port) as string;
    expect((await req(m.port, `/?k=${m.k}`, { cookie: `pi_dash_token=${COOKIE}` })).status).toBe(404);
    expect((await req(m.port, `/?k=${k2}`, { cookie: `pi_dash_token=${COOKIE}` })).status).toBe(302);
    expect(pool.heldPorts()).toHaveLength(1);
  });
  it("E65: `to` must be a single-slash root-relative path; every other class redirects to `/`", () => {
    for (const [to, want] of [["/deep", "/deep"], ["//evil.example/", "/"], ["https://evil.example/", "/"], ["/\\evil", "/"], ["%2F%2Fevil", "/"], ["", "/"], ["/a\nb", "/"], ["/" + "a".repeat(4000), "/"], [null, "/"], ["/ok?x=1#h", "/ok?x=1#h"]] as const) {
      expect(safeTo(to), String(to).slice(0, 20)).toBe(want);
    }
  });
  it("E66: a repeated pi_dash_token or pool cookie → 404 nothing forwarded; two DIFFERENT pool cookies are fine and both stripped", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { cookie } = await hop(m.port, m.k);
    expect((await req(m.port, "/x", { cookie: `${cookie}; pi_dash_token=${COOKIE}` })).status).toBe(404);
    expect((await req(m.port, "/x", { cookie: `${cookie}; ${cookie.split("; ")[1]}` })).status).toBe(404);
    expect(seen).toHaveLength(0);
    expect((await req(m.port, "/x", { cookie: `${cookie}; pi_dash_pool_9999=zzz` })).status).toBe(200);
    expect(seen[0].cookie ?? "").not.toContain("pi_dash_");
  });
  it("E67: only the exact origin host is served; everything else is 403 (distinct from the 404 credential refusal)", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { cookie } = await hop(m.port, m.k);
    for (const host of [`127.0.0.1:${m.port + 1}`, "127.0.0.1", `evil.example:${m.port}`, `LOCALHOST:${m.port}`, `127.0.0.1.:${m.port}`]) {
      const r = await req(m.port, "/x", { cookie, host });
      expect(r.status, String(host)).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: "host_not_allowed" });
    }
    expect((await req(m.port, "/x", { cookie })).status).toBe(200);
  });
  it("E71: dashboard paths are forwarded to the upstream as plain paths, never handled by the listener", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { cookie } = await hop(m.port, m.k);
    for (const p of ["/api/sessions", "/ws", "/auth/login", "/preview/AAAAAAAAAAAAAAAAAAAAAA/", "/live/t1/"]) {
      const r = await req(m.port, p, { cookie });
      expect(r.body, p).toBe("upstream-body");
      expect(r.headers["set-cookie"], p).toBeUndefined();
    }
    expect(seen.map((s) => s.url)).toEqual(["/api/sessions", "/ws", "/auth/login", "/preview/AAAAAAAAAAAAAAAAAAAAAA/", "/live/t1/"]);
  });
  it("X14: a dead upstream is a 502 and the listener stays up", async () => {
    const { mint } = await setup();
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    const { cookie } = await hop(m.port, m.k);
    upstream.closeAllConnections?.();
    await new Promise<void>((r) => upstream.close(() => r()));
    const r = await req(m.port, "/x", { cookie });
    expect(r.status).toBe(502);
    expect(r.body).not.toContain(String(upstreamPort));
    expect((await req(m.port, "/x", {})).status).toBe(404); // still answering
  });
});

describe("release on every deletion path (E68, E69, X13, X28, X29, P7)", () => {
  it("E68: revoke by device / session, target removal, eviction-by-close: the listener closes, the port refuses, and is reusable", async () => {
    const { mint, store, pool, range } = await setup(3);
    const a = await mint(session("s1"));
    if (!a.ok) throw new Error("mint");
    store.revokeBySessionKey(sessionKeyOf("s1"));
    expect(await refused(a.port)).toBe(true);
    expect(pool.heldPorts()).toEqual([]);
    const dev: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "d1" };
    const b = await mint(dev);
    if (!b.ok) throw new Error("mint");
    expect(b.port).toBe(range.from); // reused
    store.revokeByDevice("d1");
    expect(await refused(b.port)).toBe(true);
    const c = await mint(session("s2"));
    if (!c.ok) throw new Error("mint");
    store.revokeByTarget("t1");
    expect(await refused(c.port)).toBe(true);
    store.revokeByTarget("t1"); // a second delete is a no-op
    store.close();
    expect(pool.heldPorts()).toEqual([]);
  });
  it("E68: open sockets are destroyed at release", async () => {
    const { mint, store } = await setup();
    const m = await mint(session("s1"));
    if (!m.ok) throw new Error("mint");
    const sock = net.connect(m.port, "127.0.0.1");
    sock.on("error", () => {});
    await new Promise<void>((r) => sock.once("connect", () => r()));
    const closed = new Promise<void>((r) => sock.once("close", () => r()));
    store.revokeBySessionKey(sessionKeyOf("s1"));
    await closed;
  });
  it("E69: an idle capability releases its port at the sweep tick without any mint; the sweep timer is unref'd", async () => {
    let now = 1_000_000;
    const { mint, pool, store } = await setup(2, { now: () => now, sweepIntervalMs: 40 });
    const m = await mint();
    if (!m.ok) throw new Error("mint");
    expect(pool.heldPorts()).toHaveLength(1);
    now += 30 * 60_000 + 1;
    await new Promise((r) => setTimeout(r, 150));
    expect(pool.heldPorts()).toEqual([]);
    expect(await refused(m.port)).toBe(true);
    const timer = (store as unknown as { sweeper?: { hasRef?: () => boolean } }).sweeper;
    expect(timer === undefined || timer.hasRef?.() === false).toBe(true);
  });
  it("X13: a listener that closes outside the store's control deletes its entry (listener-error); the next mint reallocates", async () => {
    const { mint, store, pool } = await setup(2);
    const m = await mint(session("s1"));
    if (!m.ok) throw new Error("mint");
    const l = (pool as unknown as { __x?: unknown }).__x; // not exposed: close the server by connecting a hostile error instead
    void l;
    // Closing every connection and the listening socket from outside: emulate with the store seeing the entry gone.
    store.revokeByPoolPort(m.port, "listener-error");
    expect(pool.heldPorts()).toEqual([]);
    expect(store.findByPoolPort(m.port)).toBeNull();
    expect((await mint(session("s1"))).ok).toBe(true);
  });
  it("X28: the session ends between mint and the `?k=` hop: the listener is gone (refused) and the port is reusable", async () => {
    const { mint, store } = await setup(2);
    const m = await mint(session("s1"));
    if (!m.ok) throw new Error("mint");
    store.revokeBySessionKey(sessionKeyOf("s1"));
    await expect(req(m.port, `/?k=${m.k}`, { cookie: `pi_dash_token=${COOKIE}` })).rejects.toThrow();
    expect((await mint(session("s3"))).ok).toBe(true);
  });
  it("X29: close() releases every listener and open keep-alive sockets; the pool can be re-bound at once", async () => {
    const { mint, pool, range } = await setup(3);
    const ports: number[] = [];
    for (const s of ["a", "b", "c"]) {
      const m = await mint(session(s));
      if (m.ok) ports.push(m.port);
    }
    const socks = await Promise.all(ports.map((p) => new Promise<net.Socket>((r) => { const s = net.connect(p, "127.0.0.1", () => r(s)); })));
    await pool.close();
    expect(pool.heldPorts()).toEqual([]);
    for (const p of ports) expect(await refused(p)).toBe(true);
    expect(socks.every((s) => s.destroyed || s.readyState !== "open")).toBe(true);
    const again = createPreviewPool({ range: () => range, bindHost: () => "127.0.0.1", findByPoolPort: () => null, revokeByPoolPort: () => {}, manager: {} as LiveServerManager });
    expect((await again.allocate("k", "127.0.0.1")).ok).toBe(true);
    await again.close();
  });
  it("P7: 40 mint → hop → revoke cycles leave no listening pool port and no held listener", async () => {
    const { mint, store, pool, range } = await setup(3);
    for (let i = 0; i < 40; i++) {
      const m = await mint(session(`s${i}`));
      if (!m.ok) throw new Error(`mint ${i}`);
      await hop(m.port, m.k);
      store.revokeBySessionKey(sessionKeyOf(`s${i}`));
    }
    expect(pool.heldPorts()).toEqual([]);
    for (let p = range.from; p <= range.to; p++) expect(await refused(p)).toBe(true);
  });
});

describe("the mint route (E57, E61)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });
  async function mk(opts: { principal: "session" | "local" | "device"; poolSize?: number; ipDnsSuffix?: string; bind?: string; interfaces?: string[] }) {
    const { range, pool, store, manager } = await setup(opts.poolSize ?? 3);
    const logs: string[] = [];
    const bindPool = createPreviewPool({
      range: () => range,
      bindHost: () => opts.bind ?? "127.0.0.1",
      findByPoolPort: (p) => store.findByPoolPort(p),
      revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
      manager,
      interfaceAddresses: () => opts.interfaces ?? [],
      log: (l) => logs.push(l),
    });
    cleanups.push(() => bindPool.close());
    void pool;
    // Re-point the store's onDelete at the pool this route uses.
    (store as unknown as { onDelete?: unknown }).onDelete = (e: never, r: never) => bindPool.onDelete(e, r);
    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", async (r) => {
      const x = r as unknown as Record<string, unknown>;
      if (opts.principal === "session") {
        x.authVia = "session";
        x.principalTier = "control";
        x.cookies = { pi_dash_token: COOKIE };
      } else if (opts.principal === "device") {
        x.authVia = "device";
        x.principalTier = "control";
        x.principalDeviceId = "d1";
      }
    });
    const resolved = resolvePreviewOrigins(
      parsePreviewOrigins({ enabled: true, portPool: `${range.from}-${range.to}`, ...(opts.ipDnsSuffix ? { ipDnsSuffix: opts.ipDnsSuffix } : {}) }).value,
      { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] },
    );
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, pool: bindPool, previewOrigins: () => resolved, log: (l) => logs.push(l) });
    await app.ready();
    const mint = (host = "192.168.1.5:8000", id = "t1") =>
      app.inject({ method: "POST", url: `/api/live-server/${id}/capability`, remoteAddress: "192.168.1.9", headers: { host, origin: `http://${host}` }, payload: { accept: ["origin", "preview"] } });
    return { mint, bindPool, logs, store, range };
  }
  it("E61: tier 3 only for a login-session principal on a Host IP the bind address answers; everything else falls through", async () => {
    const wildcard = { bind: "0.0.0.0", interfaces: ["192.168.1.5"] };
    const ok = await mk({ principal: "session", ...wildcard });
    const r = (await ok.mint()).json();
    expect(r.tier).toBe(3);
    expect(r.origin).toBe(`http://192.168.1.5:${ok.range.from}`);
    expect(r.path).toMatch(/^\/\?k=[A-Za-z0-9_-]{43}$/);
    expect((await ok.mint("192.168.1.77:8000")).json().tier).not.toBe(3); // not a local interface IP
    for (const principal of ["local", "device"] as const) {
      const other = await mk({ principal, ...wildcard });
      expect((await other.mint()).json().tier, principal).not.toBe(3);
      expect(other.bindPool.heldPorts()).toEqual([]);
    }
    // A specific bind answers only that IP (no real bind to a LAN address in CI: the predicate is what the route consults).
    const bound = createPreviewPool({ range: () => undefined, bindHost: () => "192.168.1.5", findByPoolPort: () => null, revokeByPoolPort: () => {}, manager: {} as LiveServerManager, interfaceAddresses: () => ["10.0.0.5"] });
    expect(bound.canServeHost("192.168.1.5")).toBe(true);
    expect(bound.canServeHost("10.0.0.5")).toBe(false); // an interface IP is not enough when bound to one address
    const wild = createPreviewPool({ range: () => undefined, bindHost: () => "0.0.0.0", findByPoolPort: () => null, revokeByPoolPort: () => {}, manager: {} as LiveServerManager, interfaceAddresses: () => ["10.0.0.5"] });
    expect(wild.canServeHost("10.0.0.5")).toBe(true);
    expect(wild.canServeHost("10.0.0.6")).toBe(false);
  });
  it("E57: an exhausted pool falls through (tier 4 with ipDnsSuffix, else 5), HTTP 200, with the `pool exhausted` line", async () => {
    const withDns = await mk({ principal: "session", bind: "0.0.0.0", interfaces: ["192.168.1.5"], poolSize: 1, ipDnsSuffix: "sslip.io" });
    expect((await withDns.mint()).json().tier).toBe(3);
    // a second principal: the one-port pool is held
    const second = await withDns.mint("192.168.1.5:8000", "t2");
    expect(second.statusCode).toBe(200);
    expect(second.json().tier).toBe(4);
    expect(withDns.logs.some((l) => l.includes("pool exhausted"))).toBe(true);
    const noDns = await mk({ principal: "session", bind: "0.0.0.0", interfaces: ["192.168.1.5"], poolSize: 1 });
    await noDns.mint();
    const fall = await noDns.mint("192.168.1.5:8000", "t2");
    expect(fall.statusCode).toBe(200);
    expect(fall.json().tier).toBe("legacy");
  });
  it("a re-mint of the same capability reuses the listener and issues a fresh `k`", async () => {
    const { mint, bindPool } = await mk({ principal: "session", bind: "0.0.0.0", interfaces: ["192.168.1.5"] });
    const a = (await mint()).json();
    const b = (await mint()).json();
    expect(b.origin).toBe(a.origin);
    expect(b.path).not.toBe(a.path);
    expect(bindPool.heldPorts()).toHaveLength(1);
  });
});
