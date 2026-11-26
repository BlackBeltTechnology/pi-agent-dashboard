/**
 * Preview observability (D13), driven through the REAL emitters with their DEFAULT sinks (`console.log`), so the capture is
 * what an operator's log would hold:
 *   - T.E156: every line family matches the D13 grammar exactly (mint tiers 1-5 + every skip reason, pool bind / release /
 *     exhausted, reserve, `pid dropped`, boot `tiers:`, first-`admit` once per entry, `refuse`); `h=` is the first 8 hex of
 *     sha256(label | pid); no raw label, pid, token, `?k=`, full origin, path or URL appears anywhere in the capture.
 *   - T.E28: mint / refusal lines never carry the origin; the `[csrf-gate]` / `[ws-gate]` lines with a preview Origin are redacted.
 *
 * See change: serve-live-previews-on-capability-origin (D13; test-plan #E156, #E28).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { getResolvedPreviewOrigins, resetConfigSnapshot } from "../config-snapshot.js";
import { type CapabilityPrincipal, LiveCapabilityStore, sessionKeyOf } from "../live-server/live-capability.js";
import { liveLog } from "../live-server/live-log.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, previewServerFactory } from "../live-server/preview-dispatch.js";
import { createPreviewObserver } from "../live-server/preview-observe.js";
import { previewLogHash } from "../live-server/preview-origin.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createPreviewPool } from "../live-server/preview-pool.js";
import { reservePreviewPath } from "../live-server/preview-reserve.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const H8 = "[0-9a-f]{8}";
const ACCEPT_ALL = ["origin", "preview"];
const sha8 = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

/** A free run of `n` consecutive loopback ports. */
async function freeRange(n: number): Promise<{ from: number; to: number }> {
  for (let base = 24000 + Math.floor(Math.random() * 15000); ; base += n + 1) {
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

function rawGet(port: number, host: string, urlPath = "/"): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, headers: { host }, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

let tmp: string;
let origHome: string | undefined;
let captured: string[];
const cleanups: (() => Promise<void> | void)[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-e156-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  resetConfigSnapshot();
  captured = [];
  const sink = (...a: unknown[]) => void captured.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(sink);
  vi.spyOn(console, "warn").mockImplementation(sink);
  vi.spyOn(console, "error").mockImplementation(sink);
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
  process.env.HOME = origHome;
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("T.E156 / #E156 — exact redacted D13 lines", () => {
  it("every line family matches the grammar; h= is sha256 first-8; no secret, label, pid, token, ?k=, origin or path anywhere", async () => {
    // ---- boot line: `tiers: 1, 3(8100-8199), 5` (a real config read; no bind needed)
    fs.mkdirSync(path.join(tmp, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".pi", "dashboard", "config.json"), JSON.stringify({ liveServer: { previewOrigins: { portPool: "8100-8199" } } }), { mode: 0o600 });
    expect(getResolvedPreviewOrigins().tiers).toEqual([1, 3, 5]);
    expect(captured.filter((l) => l.startsWith("[live-preview] tiers:"))).toEqual(["[live-preview] tiers: 1, 3(8100-8199), 5"]);

    // ---- harness: upstream, store (fake clock) + pool + tier-5 store + routes + dispatcher with the default observer sink
    const upstream = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    cleanups.push(() => new Promise<void>((r) => { upstream.closeAllConnections?.(); upstream.close(() => r()); }));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: upstreamPort } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const range = await freeRange(1);
    let clock = 1_000_000;
    let pool!: ReturnType<typeof createPreviewPool>;
    const store = new LiveCapabilityStore({ now: () => clock, isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r) });
    pool = createPreviewPool({
      range: () => range,
      bindHost: () => "0.0.0.0",
      findByPoolPort: (p) => store.findByPoolPort(p),
      revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
      manager,
      interfaceAddresses: () => ["192.168.1.5"],
    });
    const previewPaths = new PreviewPathStore();
    cleanups.push(async () => {
      store.close();
      await pool.close();
    });

    let cfg = resolvePreviewOrigins(parsePreviewOrigins({ enabled: true }).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] });
    const resolveWith = (raw: object) => resolvePreviewOrigins(parsePreviewOrigins(raw).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] });
    const app: FastifyInstance = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", async (r) => {
      const x = r as unknown as Record<string, unknown>;
      const s = r.headers["x-test-session"];
      if (typeof s === "string") {
        x.authVia = "session";
        x.principalTier = "control";
        x.cookies = { pi_dash_token: s };
      }
    });
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, pool, previewPaths, previewOrigins: () => cfg });
    await app.ready();
    cleanups.push(() => app.close());

    const secrets: string[] = []; // every capability secret this run mints: none may appear in the capture
    const mint = async (opts: { host: string; origin?: string; from?: string; accept?: unknown; session?: string; headers?: Record<string, string> }) => {
      const res = await app.inject({
        method: "POST",
        url: "/api/live-server/vite-5173/capability",
        remoteAddress: opts.from ?? "127.0.0.1",
        headers: { host: opts.host, ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.session ? { "x-test-session": opts.session } : {}), ...(opts.headers ?? {}) },
        payload: { accept: opts.accept },
      });
      const j = res.json() as Record<string, any>;
      if (j.origin) {
        secrets.push(j.origin, new URL(j.origin).host);
        if (j.tier !== 3) secrets.push(new URL(j.origin).hostname.split(".")[0]);
      }
      if (typeof j.path === "string" && j.path !== "/") secrets.push(j.path, ...j.path.split("/").filter((s: string) => s.length >= 22));
      return j;
    };
    const mintLines = () => captured.filter((l) => l.startsWith("[live-preview] mint "));

    // ---- mints: tier 1, no-accept, forwarding-headers, disabled
    const t1 = await mint({ host: "localhost:8000", origin: "http://localhost:8000", accept: ["origin"] });
    expect(t1.tier).toBe(1);
    const label1 = new URL(t1.origin).hostname.split(".")[0];
    await mint({ host: "localhost:8000", origin: "http://localhost:8000", accept: undefined });
    await mint({ host: "localhost:8000", origin: "http://localhost:8000", accept: ["origin"], headers: { "x-forwarded-for": "203.0.113.9" } });
    const saved = cfg;
    cfg = resolveWith({ enabled: false });
    await mint({ host: "localhost:8000", origin: "http://localhost:8000", accept: ACCEPT_ALL });
    // ---- tier 2
    cfg = resolveWith({ wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] } });
    const t2 = await mint({ host: "dash.example.com", origin: "https://dash.example.com", accept: ["origin"] });
    expect(t2.tier).toBe(2);
    // ---- tier 3 (bind) → exhausted (second principal, one-port pool) → tier 4
    cfg = resolveWith({ portPool: `${range.from}-${range.to}`, ipDnsSuffix: "sslip.io" });
    const t3 = await mint({ host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000", from: "192.168.1.9", accept: ["origin"], session: "s1" });
    expect(t3.tier).toBe(3);
    const k = (t3.path as string).slice("/?k=".length);
    secrets.push(k);
    const t4 = await mint({ host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000", from: "192.168.1.9", accept: ["origin"], session: "s2" });
    expect(t4.tier).toBe(4);
    // ---- tier 5
    cfg = saved;
    const t5 = await mint({ host: "localhost:8000", origin: "http://localhost:8000", accept: ["preview"] });
    expect(t5.tier).toBe(5);
    const pid5 = (t5.path as string).split("/")[2];
    secrets.push(pid5);

    // ---- mint grammar, reasons and h=
    const mintRe = new RegExp(`^\\[live-preview\\] mint tier=(1|2|3|4|5|legacy) target=vite-5173( h=${H8})? via=\\S+ peerLocal=(true|false) reason=(first-match|pool-exhausted|no-accept|disabled|forwarding-headers)$`);
    for (const l of mintLines()) expect(l, l).toMatch(mintRe);
    const reasons = mintLines().map((l) => /reason=(\S+)$/.exec(l)?.[1]);
    expect(reasons).toEqual(["first-match", "no-accept", "forwarding-headers", "disabled", "first-match", "first-match", "pool-exhausted", "first-match", "first-match"]);
    expect(mintLines()[0]).toBe(`[live-preview] mint tier=1 target=vite-5173 h=${sha8(label1)} via=localhost:8000 peerLocal=true reason=first-match`);
    expect(mintLines().at(-1)).toBe(`[live-preview] mint tier=5 target=vite-5173 h=${sha8(pid5)} via=localhost:8000 peerLocal=true reason=first-match`);
    for (const l of mintLines().filter((x) => /tier=legacy/.test(x))) expect(l).not.toMatch(/ h=/);
    const label2 = new URL(t2.origin).hostname.split(".")[0];
    expect(mintLines().some((l) => l.includes(`tier=2 target=vite-5173 h=${sha8(label2)} `))).toBe(true);

    // ---- pool lines: bind + exhausted (+ the exhausted range)
    expect(captured).toContain(`[live-preview] pool bind port=${range.from} host=0.0.0.0`);
    expect(captured).toContain(`[live-preview] pool exhausted range=${range.from}-${range.to}`);

    // ---- pool release: revoked, expired, evicted, shutdown
    const releases = () => captured.filter((l) => l.startsWith("[live-preview] pool release "));
    store.revokeBySessionKey(sessionKeyOf("s1"));
    expect(releases().at(-1)).toBe(`[live-preview] pool release port=${range.from} reason=revoked`);
    // expired: a fresh tier-3 entry whose idle window passes, collected by the store's sweep
    cfg = resolveWith({ portPool: `${range.from}-${range.to}` });
    await mint({ host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000", from: "192.168.1.9", accept: ["origin"], session: "s3" });
    clock += 31 * 60_000;
    store.mint("vite-5173", { kind: "local" }); // mint sweeps
    expect(releases().at(-1)).toBe(`[live-preview] pool release port=${range.from} reason=expired`);
    // evicted: the principal's 65th live entry pushes its oldest (the pool entry) out
    await mint({ host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000", from: "192.168.1.9", accept: ["origin"], session: "s4" });
    const s4: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: sessionKeyOf("s4") };
    for (let i = 0; i < 64; i++) store.mint("vite-5173", s4);
    expect(releases().at(-1)).toBe(`[live-preview] pool release port=${range.from} reason=evicted`);
    // shutdown
    await mint({ host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000", from: "192.168.1.9", accept: ["origin"], session: "s5" });
    store.close();
    expect(releases().at(-1)).toBe(`[live-preview] pool release port=${range.from} reason=shutdown`);
    expect(releases().map((l) => /reason=(\S+)$/.exec(l)?.[1])).toEqual(["revoked", "expired", "evicted", "shutdown"]);
    for (const l of releases()) expect(l).toMatch(/^\[live-preview\] pool release port=\d+ reason=(expired|revoked|evicted|shutdown|config-changed|listener-error)$/);

    // ---- reserve + `pid dropped` (the server.ts wiring of PreviewPathStore.onDrop → liveLog)
    let now = 5_000_000;
    let live = true;
    const alive = new Set(["t"]);
    const dev: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "a" };
    const paths = new PreviewPathStore({
      now: () => now,
      targetIdForPort: (p) => (p === 5299 ? "t" : undefined),
      isTargetLive: (id) => alive.has(id),
      isPrincipalLive: () => live,
      onDrop: (reason, pid) => liveLog(undefined, "pid dropped", { reason, h: previewLogHash(pid) }),
    });
    const reserved = reservePreviewPath({ store: paths, hasTier5Viewer: () => true, portRefusal: () => null }, 5299, { key: "k1", principal: dev }, "r1", "sess-1");
    expect(reserved.kind).toBe("ok");
    const reservedPid = reserved.kind === "ok" ? reserved.path.split("/")[2] : "";
    secrets.push(reservedPid);
    expect(captured).toContain(`[live-preview] reserve port=5299 session=sess-1 h=${sha8(reservedPid)}`);
    const policy = { policy: { egress: "restricted", scripts: false } } as const;
    const mintPid = (): string => {
      const m = paths.mint("t", dev, policy);
      if (!m.ok) throw new Error("mint");
      secrets.push(m.pid);
      return m.pid;
    };
    const a = mintPid();
    live = false;
    paths.sweep();
    live = true;
    const b = mintPid();
    alive.delete("t");
    paths.sweep();
    alive.add("t");
    const c = mintPid();
    now += 13 * 3_600_000;
    paths.sweep();
    const drops = captured.filter((l) => l.startsWith("[live-preview] pid dropped "));
    // the revoked holder also owned the unbound reservation: it is dropped in the same sweep
    expect([...drops].sort()).toEqual(
      [
        `[live-preview] pid dropped reason=holder-revoked h=${sha8(a)}`,
        `[live-preview] pid dropped reason=holder-revoked h=${sha8(reservedPid)}`,
        `[live-preview] pid dropped reason=target-removed h=${sha8(b)}`,
        `[live-preview] pid dropped reason=expired h=${sha8(c)}`,
      ].sort(),
    );

    // ---- admit (first per entry only) + refuse, through the real dispatcher with the default observer sink
    const observer = createPreviewObserver();
    const entryStore = new LiveCapabilityStore({ isTargetLive: () => true });
    cleanups.push(() => entryStore.close());
    const dispatch = createPreviewDispatch({
      store: entryStore,
      manager,
      isPeerLocal: () => true,
      onRefused: (r, h) => observer.refused(r, h),
      onAdmitted: (h, tier) => observer.admitted(h, tier),
    });
    const front = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    front.get("/", async () => "dashboard");
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
    });
    const fport = (front.server.address() as AddressInfo).port;
    const e = entryStore.mint("vite-5173", { kind: "local" }, { preview: { tier: 1, ancestors: ["http://localhost:8000"], buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }) } });
    secrets.push(e.token);
    for (let i = 0; i < 3; i++) expect((await rawGet(fport, `${e.token}.localhost:8000`)).status).toBe(200);
    const stranger = "b".repeat(26);
    expect((await rawGet(fport, `${stranger}.localhost:8000`)).status).toBe(403);
    expect(captured.filter((l) => l.startsWith("[live-preview] admit "))).toEqual([`[live-preview] admit h=${sha8(e.token)} tier=1`]);
    expect(captured.filter((l) => l.startsWith("[live-preview] refuse "))).toEqual([`[live-preview] refuse h=${sha8(stranger)} reason=unknown`]);
    secrets.push(stranger);

    // ---- whole-capture scan: grammar of every [live-preview] line, and no secret anywhere
    const known = [
      /^\[live-preview\] tiers: [\d, ()-]+$/,
      mintRe,
      /^\[live-preview\] pool bind port=\d+ host=\S+$/,
      /^\[live-preview\] pool release port=\d+ reason=[a-z-]+$/,
      /^\[live-preview\] pool exhausted range=\d+-\d+$/,
      new RegExp(`^\\[live-preview\\] reserve port=\\d+ session=\\S+ h=${H8}$`),
      new RegExp(`^\\[live-preview\\] pid dropped reason=(holder-revoked|expired|target-removed|adoption-refused) h=${H8}$`),
      new RegExp(`^\\[live-preview\\] admit h=${H8} tier=(1|2|3|4|5|legacy)$`),
      new RegExp(`^\\[live-preview\\] refuse( h=${H8})? reason=(unknown|expired|wrong-host|wrong-port|malformed-host|not-a-label|duplicate-host|no-target|disabled)$`),
    ];
    const live_lines = captured.filter((l) => l.startsWith("[live-preview]"));
    expect(live_lines.length).toBeGreaterThan(20);
    for (const l of live_lines) expect(known.some((re) => re.test(l)), l).toBe(true);
    const all = captured.join("\n");
    for (const s of new Set(secrets.filter((x) => x.length >= 8))) expect(all, `leaked secret ${s.slice(0, 6)}…`).not.toContain(s);
    expect(all).not.toMatch(/\b[a-z2-7]{26}\./i); // no label-shaped host anywhere
    expect(all).not.toMatch(/\/preview\/[A-Za-z0-9_-]{16,}/); // no tier-5 path
    expect(all).not.toMatch(/\?k=/);
    expect(all).not.toContain("~c/");
    expect(all).not.toMatch(/https?:\/\/[a-z2-7]{26}/i);
  });
});

describe("T.E28 / #E28 — log fields never carry the origin; gate lines redact a preview Origin", () => {
  it("mint tier 1 / tier 5 / legacy and an unknown-label refusal: only tier=, reason=, h=<8 hex>; no label, origin, path or token", async () => {
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    const observer = createPreviewObserver();
    const dispatch = createPreviewDispatch({
      store,
      manager,
      isPeerLocal: () => true,
      onRefused: (r, h) => observer.refused(r, h),
    });
    // the dashboard app behind the dispatching server factory: one real HTTP listener for mint + label hosts
    const app: FastifyInstance = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    app.decorateRequest("isAuthenticated", false);
    registerLiveServerRoutes(app, manager, {
      networkGuard: async () => undefined,
      capabilities: store,
      previewPaths: new PreviewPathStore(),
      previewOrigins: () => resolvePreviewOrigins(parsePreviewOrigins({ enabled: true }).value, { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] }),
    });
    await dispatch.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const conns = new Set<Socket>();
    app.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
    cleanups.push(async () => {
      for (const s of conns) s.destroy();
      await app.close();
      await dispatch.close();
      store.close();
    });
    const mint = async (accept: unknown) =>
      (await app.inject({ method: "POST", url: "/api/live-server/vite-5173/capability", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", origin: "http://localhost:8000" }, payload: { accept } })).json() as Record<string, any>;
    const t1 = await mint(["origin"]);
    const t5 = await mint(["preview"]);
    const legacy = await mint(undefined);
    expect([t1.tier, t5.tier, legacy.tier]).toEqual([1, 5, "legacy"]);
    // an unknown label on the real listener: the dispatcher's refusal observer writes the `refuse` line
    const stranger = "c".repeat(26);
    const port = (app.server.address() as AddressInfo).port;
    expect((await rawGet(port, `${stranger}.localhost:8000`)).status).toBe(403);

    const label = new URL(t1.origin).hostname.split(".")[0];
    const pid = (t5.path as string).split("/")[2];
    const token = (legacy.path as string).split("/")[4];
    const previewLines = captured.filter((l) => l.startsWith("[live-preview]") && !l.startsWith("[live-preview] tiers:"));
    expect(previewLines).toHaveLength(4);
    expect(previewLines[3]).toBe(`[live-preview] refuse h=${previewLogHash(stranger)} reason=unknown`);
    for (const l of previewLines) {
      expect(l, l).toMatch(/\b(tier=(1|5|legacy)|reason=\w[\w-]*)\b/);
      for (const m of l.matchAll(/\bh=(\S+)/g)) expect(m[1]).toMatch(new RegExp(`^${H8}$`));
    }
    const all = captured.join("\n");
    for (const secret of [label, pid, token, t1.origin, new URL(t1.origin).host, stranger, legacy.path, t5.path]) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/\/live\//);
    expect(all).not.toMatch(/\/preview\//);
  });

  it("`[csrf-gate]` rejects a preview Origin with the label redacted (lower, UPPER, trailing-dot forms)", async () => {
    const app = Fastify({ logger: false });
    app.addHook("onRequest", createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] })));
    app.post("/api/tunnel-connect", async () => ({ ok: true }));
    await app.ready();
    cleanups.push(() => app.close());
    const label = "k7q4zm2x5c6h3v4d5fjqwyabn7";
    const origins = [`http://${label}.localhost:8000`, `http://${label.toUpperCase()}.LOCALHOST.:8000`, `https://${label}.preview.example.com`];
    for (const origin of origins) {
      const r = await app.inject({ method: "POST", url: "/api/tunnel-connect", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", origin } });
      expect(r.statusCode, origin).toBe(403);
    }
    const csrf = captured.filter((l) => l.startsWith("[csrf-gate]"));
    expect(csrf).toHaveLength(3);
    expect(csrf[0]).toContain("origin=http://<redacted>.localhost:8000");
    expect(csrf[1]).toContain("origin=http://<redacted>.LOCALHOST.:8000");
    expect(csrf[2]).toContain("origin=https://<redacted>.preview.example.com");
    const all = captured.join("\n");
    expect(all.toLowerCase()).not.toContain(label);
  });

  it("`[ws-gate]` (REAL server upgrade) rejects a preview Origin with the label redacted in lower and UPPER case", async () => {
    const { createTestServer } = await import("../test-support/test-server.js");
    const { proofHeaders } = await import("../test-support/local-credential-stamp.js");
    const { WebSocket } = await import("ws");
    const handle = await createTestServer();
    cleanups.push(() => handle.stop());
    const port = handle.httpPort;
    const label = "k7q4zm2x5c6h3v4d5fjqwyabn7";
    for (const origin of [`http://${label}.localhost:${port}`, `http://${label.toUpperCase()}.LOCALHOST.:${port}`]) {
      const status = await new Promise<number | string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { ...proofHeaders(`http://127.0.0.1:${port}/ws`), origin } });
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("open", () => {
          ws.close();
          resolve("open");
        });
        ws.on("error", () => resolve("error"));
      });
      expect(status, origin).toBe(403);
    }
    const wsLines = captured.filter((l) => l.startsWith("[ws-gate] rejected upgrade"));
    expect(wsLines).toHaveLength(2);
    expect(wsLines[0]).toContain(`origin=http://<redacted>.localhost:${port}`);
    expect(wsLines[1]).toContain(`origin=http://<redacted>.LOCALHOST.:${port}`);
    expect(captured.join("\n").toLowerCase()).not.toContain(label);
  });
});
