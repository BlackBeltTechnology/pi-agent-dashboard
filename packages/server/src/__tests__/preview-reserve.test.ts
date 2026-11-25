/**
 * Reserve-path API (D9): store reservations (bounds, lifetime, adoption, release), REST routes, the bridge pair,
 * and the tier-5 viewer count.
 * See change: serve-live-previews-on-capability-origin (D9; test-plan #E89-#E104, #P12, #X22-#X27 server halves).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type CapabilityPrincipal, LiveCapabilityStore, principalKeyOf } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { bridgeReserverKey, handlePreviewPathRelease, handlePreviewPathRequest } from "../live-server/preview-path-bridge.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { hasTier5Viewer, markPreviewAccept, stampPreviewViewer } from "../live-server/preview-viewers.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const dev = (id: string): CapabilityPrincipal => ({ kind: "device", tier: "control", deviceId: id });
const key = (p: CapabilityPrincipal) => principalKeyOf(p);
const reserver = (p: CapabilityPrincipal) => ({ key: key(p), principal: p });
const POLICY = { policy: { egress: "restricted", scripts: false } } as const;
const MIN = 60_000;

function mkStore(over: { targets?: Map<number, string>; allowed?: (p: number) => boolean; live?: (p: CapabilityPrincipal) => boolean } = {}) {
  let now = 1_000_000;
  const targets = over.targets ?? new Map<number, string>();
  const store = new PreviewPathStore({
    now: () => now,
    targetIdForPort: (port) => targets.get(port),
    isPortAllowed: over.allowed ?? (() => true),
    isPrincipalLive: over.live ?? (() => true),
  });
  return { store, targets, advance: (ms: number) => void (now += ms) };
}

describe("reservation bounds (E93, P12)", () => {
  it("8 per principal, 64 global, never evicted; same (principal, port) replaces", () => {
    const { store } = mkStore();
    const p = dev("a");
    for (let port = 5000; port < 5008; port++) expect(store.reserve(port, reserver(p)).ok).toBe(true);
    expect(store.reserve(5008, reserver(p))).toEqual({ ok: false, reason: "principal-cap" });
    const again = store.reserve(5000, reserver(p)); // replacement: not a 9th
    expect(again.ok).toBe(true);
    expect(store.reservationCount()).toBe(8);
    for (let i = 0; store.reservationCount() < 64; i++) expect(store.reserve(6000 + i, reserver(dev(`o${Math.floor(i / 8)}`))).ok).toBe(true);
    expect(store.reserve(9000, reserver(dev("late")))).toEqual({ ok: false, reason: "total-cap" });
    expect(store.reservationCount()).toBe(64);
  });
  it("P12: 1000 reserve/replace/release cycles never exceed the caps and drain to zero on expiry", () => {
    const { store, advance } = mkStore();
    const ps = Array.from({ length: 9 }, (_, i) => dev(`p${i}`));
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      const p = ps[i % 9];
      const r = store.reserve(7000 + (i % 13), reserver(p));
      if (r.ok && i % 5 === 0 && r.reserved) store.releaseReservation(r.pid, key(p));
      max = Math.max(max, store.reservationCount());
    }
    expect(max).toBeLessThanOrEqual(64);
    advance(11 * MIN);
    store.sweep();
    expect(store.reservationCount()).toBe(0);
  });
});

describe("reservation lifetime (E95, E96)", () => {
  it("(a) no target: usable to 10 min; gone from 10m01s", () => {
    const { store, advance } = mkStore();
    const p = dev("a");
    const r = store.reserve(5299, reserver(p));
    expect(r.ok && r.expiresAt - 1_000_000).toBe(10 * MIN);
    advance(9 * MIN + 59_000);
    store.sweep();
    expect(store.reservationCount()).toBe(1);
    advance(2_000);
    store.sweep();
    expect(store.reservationCount()).toBe(0);
  });
  it("(b) target present: up to 12 h from creation; on target removal the 10-minute rule resumes", () => {
    const { store, advance, targets } = mkStore({ targets: new Map([[5299, "t"]]) });
    // `currentPid("t")` is null (no pid yet) so this is a plain reservation
    const r = store.reserve(5299, reserver(dev("a")));
    expect(r.ok && r.expiresAt - 1_000_000).toBe(12 * 3_600_000);
    advance(11 * 3_600_000 + 59 * MIN);
    store.sweep();
    expect(store.reservationCount()).toBe(1);
    targets.delete(5299);
    store.sweep();
    expect(store.reservationCount()).toBe(0); // creation + 10 min is long past
  });
  it("E96: target appears at 9m and disappears at 9m30s", () => {
    const { store, advance, targets } = mkStore();
    store.reserve(5299, reserver(dev("a")));
    advance(9 * MIN);
    targets.set(5299, "t");
    advance(30_000);
    targets.delete(5299);
    advance(MIN);
    store.sweep();
    expect(store.reservationCount()).toBe(0);
  });
  it("a reserver whose principal is no longer live drops its reservation", () => {
    let live = true;
    const { store } = mkStore({ live: () => live });
    store.reserve(5299, reserver(dev("a")));
    live = false;
    store.sweep();
    expect(store.reservationCount()).toBe(0);
  });
});

describe("a reserved pid is indistinguishable from an unknown pid (E97)", () => {
  it("validate() never sees it, for anyone", () => {
    const { store } = mkStore();
    const r = store.reserve(5299, reserver(dev("a")));
    if (!r.ok) throw new Error("reserve");
    expect(store.validate(r.pid, { genuinelyLocal: true })).toBeNull();
    expect(store.validate("U".repeat(22), { genuinelyLocal: true })).toBeNull();
  });
});

describe("adoption (E98, E99, E104)", () => {
  const mintFor = (store: PreviewPathStore, p: CapabilityPrincipal, port = 5299, targetId = "t") => store.mint(targetId, p, { ...POLICY, port });
  it("adopts the newest reservation, drops older ones, reserver becomes a revocation-only holder", () => {
    const { store } = mkStore({ targets: new Map([[5299, "t"]]) });
    const [p, q, m] = [dev("p"), dev("q"), dev("m")];
    const rp = store.reserve(5299, reserver(p));
    const rq = store.reserve(5299, reserver(q));
    if (!rp.ok || !rq.ok) throw new Error("reserve");
    const minted = mintFor(store, m);
    expect(minted.ok && minted.pid).toBe(rq.pid);
    expect(store.reservationCount()).toBe(0);
    // the reserver does not admit requests (revocation-only), the minter does
    expect(store.validate(rq.pid, { genuinelyLocal: true })?.minterKey).toBe(key(m));
    expect(store.size()).toBe(1);
  });
  it("a live pid wins and every reservation for the port is discarded", () => {
    const { store } = mkStore({ targets: new Map([[5299, "t"]]) });
    const first = mintFor(store, dev("m"));
    store.reserve(6000, reserver(dev("p"))); // other port: untouched
    expect(store.reserve(5299, reserver(dev("p")))).toMatchObject({ ok: true, reserved: false, pid: first.ok ? first.pid : "" });
    const second = mintFor(store, dev("n"));
    expect(second.ok && second.pid).toBe(first.ok && first.pid);
    expect(store.reservationCount()).toBe(1);
  });
  it("E92: reserving while a live pid exists returns it, creates no reservation, and the caller can revoke it", () => {
    let live = (_: CapabilityPrincipal) => true;
    const { store } = mkStore({ targets: new Map([[5299, "t"]]), live: (p) => live(p) });
    const minted = mintFor(store, dev("q"));
    const r = dev("r");
    const got = store.reserve(5299, reserver(r));
    expect(got).toMatchObject({ ok: true, reserved: false });
    expect(store.reservationCount()).toBe(0);
    live = (p) => p.deviceId !== "r"; // R's device is revoked → the shared pid dies for everyone
    expect(store.validate(minted.ok ? minted.pid : "", { genuinelyLocal: true })).toBeNull();
  });
  it("E99: the SSRF gate is re-run at adoption; a refused reservation is dropped and the mint refused", () => {
    let ok = true;
    const { store } = mkStore({ targets: new Map([[5299, "t"]]), allowed: () => ok });
    store.reserve(5299, reserver(dev("p")));
    ok = false;
    expect(mintFor(store, dev("m"))).toEqual({ ok: false, reason: "adoption-refused" });
    expect(store.reservationCount()).toBe(0);
  });
  it("E104: two minters get the SAME pid; the reservation is consumed once", () => {
    const { store } = mkStore({ targets: new Map([[5299, "t"]]) });
    const r = store.reserve(5299, reserver(dev("p")));
    const [a, b] = [mintFor(store, dev("m")), mintFor(store, dev("n"))];
    expect(a.ok && b.ok && a.pid === b.pid && a.pid === (r.ok ? r.pid : "")).toBe(true);
    expect(store.size()).toBe(1);
  });
  it("E94: adoption counts against the adopter's pid cap and is refused at it (reservation kept)", () => {
    const { store } = mkStore();
    const m = dev("m");
    for (let i = 0; i < 32; i++) expect(store.mint(`x${i}`, m, POLICY).ok).toBe(true);
    store.reserve(5299, reserver(dev("p")));
    expect(mintFor(store, m)).toEqual({ ok: false, reason: "principal-cap" });
    expect(store.reservationCount()).toBe(1);
  });
});

describe("release (E100) and concurrent reserve (E103)", () => {
  it("only the reserver releases an UNBOUND reservation; adopted / unknown / foreign / twice are refused", () => {
    const { store } = mkStore({ targets: new Map([[5299, "t"]]) });
    const [p, q] = [dev("p"), dev("q")];
    const r = store.reserve(5299, reserver(p));
    if (!r.ok) throw new Error("reserve");
    expect(store.releaseReservation(r.pid, key(q))).toBe(false);
    expect(store.releaseReservation("Z".repeat(22), key(p))).toBe(false);
    expect(store.releaseReservation(r.pid, key(p))).toBe(true);
    expect(store.releaseReservation(r.pid, key(p))).toBe(false);
    const r2 = store.reserve(5299, reserver(p));
    store.mint("t", dev("m"), { ...POLICY, port: 5299 }); // adopts r2
    expect(store.releaseReservation(r2.ok ? r2.pid : "", key(p))).toBe(false); // X27: adopted pid keeps serving
    expect(store.validate(r2.ok ? r2.pid : "", { genuinelyLocal: true })).not.toBeNull();
  });
  it("E103: two reserves by the same principal for the same port leave exactly one", () => {
    const { store } = mkStore();
    const p = dev("p");
    const [a, b] = [store.reserve(5299, reserver(p)), store.reserve(5299, reserver(p))];
    expect(a.ok && b.ok && a.pid !== b.pid).toBe(true);
    expect(store.reservationCount()).toBe(1);
  });
});

describe("REST routes (E89, E90, E91, E92, E93, E100)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });
  async function mk(opts: { viewers?: boolean } = {}) {
    const app = Fastify({ logger: false });
    apps.push(app);
    const targets = new Map([["vite-5173", { id: "vite-5173", label: "v", host: "127.0.0.1", port: 5173 }]]);
    const manager = {
      get: (id: string) => targets.get(id),
      getByPort: (port: number) => [...targets.values()].find((t) => t.port === port),
      portRefusal: (port: number) => (port === 8000 ? "that port is the dashboard's own; it cannot be previewed" : port === 22 ? "port not allowed" : null),
      getStatic: () => undefined,
      has: (id: string) => targets.has(id),
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const store = new PreviewPathStore({ targetIdForPort: (p) => manager.getByPort(p)?.id });
    let viewers = opts.viewers ?? true;
    app.decorateRequest("isAuthenticated", false);
    registerLiveServerRoutes(app, manager, {
      networkGuard: async () => undefined,
      capabilities: new LiveCapabilityStore({ isTargetLive: () => true }),
      previewOrigins: () => resolvePreviewOrigins(parsePreviewOrigins({ enabled: true }).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] }),
      previewPaths: store,
      hasTier5Viewer: () => viewers,
      log: () => {},
    });
    await app.ready();
    const post = (body: unknown) => app.inject({ method: "POST", url: "/api/live-server/preview-path", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000" }, payload: body as object });
    return { app, store, post, setViewers: (v: boolean) => void (viewers = v) };
  }

  it("E89: {port} and {targetId} reserve `/preview/<pid>/` with an expiry", async () => {
    const { post } = await mk();
    const a = (await post({ port: 5299 })).json();
    expect(a).toMatchObject({ success: true, tier5Viewers: true });
    expect(a.path).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(a.expiresAt).toBeGreaterThan(Date.now());
    const b = (await post({ targetId: "vite-5173" })).json();
    expect(b.path).toMatch(/^\/preview\//);
  });
  it("E90: no tier-5 viewer → {path:null, tier5Viewers:false} and nothing reserved", async () => {
    const { post, store, setViewers } = await mk({ viewers: false });
    expect((await post({ port: 5299 })).json()).toEqual({ success: true, path: null, tier5Viewers: false });
    expect(store.reservationCount()).toBe(0);
    setViewers(true);
    expect((await post({ port: 5299 })).json().path).not.toBeNull();
  });
  it("E91: bodies are validated; own / disallowed ports and unknown targets are 400", async () => {
    const { post, store } = await mk();
    for (const body of [{}, { port: "5299" }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { port: 22 }, { port: 8000 }, { targetId: "nope" }, { targetId: 5 }, null]) {
      const r = await post(body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
      expect(r.json().success).toBe(false);
    }
    expect(store.reservationCount()).toBe(0);
  });
  it("E92: a port whose target already has a live pid returns that pid and reserves nothing", async () => {
    const { post, store } = await mk();
    const minted = store.mint("vite-5173", { kind: "local" }, { ...POLICY, port: 5173 });
    const r = (await post({ port: 5173 })).json();
    expect(r.path).toBe(`/preview/${minted.ok ? minted.pid : ""}/`);
    expect(store.reservationCount()).toBe(0);
  });
  it("E93: beyond the per-principal cap → 429 reservation_limit", async () => {
    const { post } = await mk();
    for (let port = 5200; port < 5208; port++) expect((await post({ port })).statusCode).toBe(200);
    const r = await post({ port: 5300 });
    expect(r.statusCode).toBe(429);
    expect(r.json()).toEqual({ success: false, error: "reservation_limit" });
  });
  it("E100: DELETE releases an unbound reservation of the caller; unknown / twice → 404", async () => {
    const { app, post, store } = await mk();
    const { path } = (await post({ port: 5299 })).json();
    const del = (p: string) => app.inject({ method: "DELETE", url: `/api/live-server/preview-path/${p}`, remoteAddress: "127.0.0.1", headers: { host: "localhost:8000" } });
    const pid = path.split("/")[2];
    expect((await del(pid)).statusCode).toBe(200);
    expect(store.reservationCount()).toBe(0);
    expect((await del(pid)).statusCode).toBe(404);
    expect((await del("Z".repeat(22))).statusCode).toBe(404);
  });
});

describe("bridge pair (E101, X22-X25 server halves)", () => {
  function setup(opts: { viewers?: boolean; tier?: "observe" | "control" | "operate" } = {}) {
    const { store } = mkStore();
    let live = true;
    const deps = {
      reserve: { store, hasTier5Viewer: () => opts.viewers ?? true, portRefusal: (p: number) => (p === 8000 ? "own" : null) },
      deviceTier: () => opts.tier,
      isSessionLive: () => live,
    };
    return { store, deps, kill: () => void (live = false) };
  }
  const req = (over: object = {}) => ({ type: "preview_path_request" as const, requestId: "r1", sessionId: "s1", port: 5299, ...over });
  const local = { channel: { admission: "local-proof" as const, provenTls: false, ticketTls: false } };

  it("local admission: reserves for the SERVER-known session and answers the path", () => {
    const { deps, store } = setup();
    const r = handlePreviewPathRequest("s1", req(), local, deps);
    expect(r).toMatchObject({ type: "preview_path_result", requestId: "r1", tier5Viewers: true });
    expect(r.path).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(store.reservationCount()).toBe(1);
  });
  it("E101: a sessionId not registered on this connection is refused; observe-tier device ticket gets insufficient_scope", () => {
    const { deps, store } = setup({ tier: "observe" });
    expect(handlePreviewPathRequest("s2", req(), local, deps)).toMatchObject({ path: null, error: "session_mismatch" });
    const ticket = { channel: { admission: "device-ticket" as const, provenTls: false, ticketTls: false, ticketDeviceId: "d1" } };
    expect(handlePreviewPathRequest("s1", req(), ticket, deps)).toEqual({ type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false, error: "insufficient_scope" });
    expect(handlePreviewPathRequest("s1", req(), undefined, deps)).toMatchObject({ error: "insufficient_scope" });
    expect(store.reservationCount()).toBe(0);
    const ok = setup({ tier: "control" });
    expect(handlePreviewPathRequest("s1", req(), ticket, ok.deps).path).not.toBeNull();
  });
  it("no viewer → path null, tier5Viewers false, nothing reserved; invalid / own port → invalid_port; cap → reservation_limit with tier5Viewers true", () => {
    const none = setup({ viewers: false });
    expect(handlePreviewPathRequest("s1", req(), local, none.deps)).toEqual({ type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false });
    const { deps } = setup();
    for (const port of ["5299", 0, 8000, 1.5]) expect(handlePreviewPathRequest("s1", req({ port }), local, deps)).toMatchObject({ error: "invalid_port" });
    for (let port = 5000; port < 5008; port++) handlePreviewPathRequest("s1", req({ requestId: `q${port}`, port }), local, deps);
    expect(handlePreviewPathRequest("s1", req({ requestId: "over", port: 5100 }), local, deps)).toMatchObject({ path: null, tier5Viewers: true, error: "reservation_limit" });
  });
  it("X22: a late `preview_path_release` drops the reservation exactly once; wrong session / unknown id is a no-op", () => {
    const { deps, store } = setup();
    handlePreviewPathRequest("s1", req(), local, deps);
    handlePreviewPathRelease("s2", { type: "preview_path_release", requestId: "r1", sessionId: "s2" }, deps);
    expect(store.reservationCount()).toBe(1);
    handlePreviewPathRelease("s1", { type: "preview_path_release", requestId: "nope", sessionId: "s1" }, deps);
    expect(store.reservationCount()).toBe(1);
    handlePreviewPathRelease("s1", { type: "preview_path_release", requestId: "r1", sessionId: "s1" }, deps);
    handlePreviewPathRelease("s1", { type: "preview_path_release", requestId: "r1", sessionId: "s1" }, deps);
    expect(store.reservationCount()).toBe(0);
  });
  it("X24: the connection's reservations die with its session", () => {
    const { deps, store, kill } = setup();
    handlePreviewPathRequest("s1", req(), local, deps);
    expect(store.dropReservationsBy(bridgeReserverKey("s1"))).toBe(1);
    handlePreviewPathRequest("s1", req({ requestId: "r2" }), local, deps);
    kill();
    store.sweep();
    expect(store.reservationCount()).toBe(0);
  });
});

describe("tier-5 viewers (E90, F17)", () => {
  const resolved = resolvePreviewOrigins(parsePreviewOrigins({ enabled: true }).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: ["https://dash.example.com"], corsOrigins: [] });
  const upgrade = (host: string, origin: string, tls = false) => ({ headers: { host, origin }, socket: { localPort: 8000, encrypted: tls } }) as never;
  it("counts only an OPEN socket that classified to tier 5 AND announced `preview`", () => {
    const loopback = { readyState: 1 };
    const remote = { readyState: 1 };
    const old = { readyState: 1 };
    expect(stampPreviewViewer(loopback, upgrade("localhost:8000", "http://localhost:8000"), { genuinelyLocal: true, resolved })).toBe(false);
    expect(stampPreviewViewer(remote, upgrade("dash.example.com", "https://dash.example.com", true), { genuinelyLocal: false, resolved })).toBe(true);
    stampPreviewViewer(old, upgrade("dash.example.com", "https://dash.example.com", true), { genuinelyLocal: false, resolved });
    markPreviewAccept(loopback, ["origin", "preview"]);
    expect(hasTier5Viewer([loopback, old])).toBe(false); // tier-1 host / old client (never announced)
    markPreviewAccept(remote, ["origin", "preview"]);
    expect(hasTier5Viewer([loopback, old, remote])).toBe(true);
    remote.readyState = 3;
    expect(hasTier5Viewer([loopback, old, remote])).toBe(false); // closed tab stops counting at once
    markPreviewAccept(old, ["origin"]);
    markPreviewAccept(old, "preview");
    expect(hasTier5Viewer([old])).toBe(false);
  });
});
