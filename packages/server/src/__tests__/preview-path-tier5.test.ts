/**
 * Tier 5 — the stable `/preview/<pid>/` capability (D8): store semantics, raw-path validation, full-path forwarding,
 * opaque-origin CORS, WS upgrade, guard jurisdiction, mint route.
 * See change: serve-live-previews-on-capability-origin (D8; test-plan #E56-#E80 family, #E130-#E132, #E143, #E144).
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import net from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { type CapabilityPrincipal, createLiveCapabilityHook, LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { handleLiveServerUpgrade, registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { parsePreviewPath } from "../live-server/preview-path.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createPreviewPreflight } from "../live-server/preview-preflight.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const MIN = 60_000;
const A: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "dev-A" };
const B: CapabilityPrincipal = { kind: "device", tier: "control", deviceId: "dev-B" };
const LOCAL: CapabilityPrincipal = { kind: "local" };
const pol = { egress: "restricted", scripts: false } as const;
let t = 1_000_000;
const mk = (extra: ConstructorParameters<typeof PreviewPathStore>[0] = {}) => new PreviewPathStore({ now: () => t, ...extra });

beforeEach(() => {
  t = 1_000_000;
});

describe("parsePreviewPath — raw-path validation", () => {
  const pid = "A".repeat(22);
  it("accepts the clean shapes and forwards `//` and `%252e` raw", () => {
    expect(parsePreviewPath(`/preview/${pid}/app.js?x=1`)).toEqual({ pid, prefix: `/preview/${pid}`, rest: "/app.js?x=1" });
    expect(parsePreviewPath(`/preview/${pid}`)?.rest).toBe("");
    expect(parsePreviewPath(`/preview/${pid}?q=1`)?.rest).toBe("?q=1");
    expect(parsePreviewPath(`/preview/${pid}//x`)?.rest).toBe("//x");
    expect(parsePreviewPath(`/preview/${pid}/%252e%252e/x`)).not.toBeNull();
  });
  it("refuses dot-segments, encoded / ~ . \\ (any hex case), raw backslash, NUL, bad pid shapes", () => {
    for (const bad of [
      `/preview/${pid}/../api`, `/preview/${pid}/./x`, `/preview/${pid}/..%2Fx`, `/preview/${pid}/%2e%2e/x`, `/preview/${pid}/%2E/x`,
      `/preview/${pid}/%7e/x`, `/preview/${pid}/%5Cx`, `/preview/${pid}/a\\b`, `/preview/${pid}/a%00b`, `/preview/${pid}%2F..`,
      `/preview/short/x`, `/preview/${pid}x/`, `/preview//x`, `/Preview/${pid}/`, `/previews/${pid}/`, "/preview/", "/preview",
    ]) {
      expect(parsePreviewPath(bad), bad).toBeNull();
    }
  });
});

describe("PreviewPathStore", () => {
  it("one stable pid per target; a re-mint returns it and adds a holder; a different target gets its own", () => {
    const s = mk();
    const a = s.mint("vite-5173", A, { policy: pol });
    const b = s.mint("vite-5173", B, { policy: pol });
    const c = s.mint("vite-3000", A, { policy: pol });
    if (!a.ok || !b.ok || !c.ok) throw new Error("mint");
    expect(a.pid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(b.pid).toBe(a.pid);
    expect(b.reused).toBe(true);
    expect(c.pid).not.toBe(a.pid);
    expect(s.size()).toBe(2);
    expect(s.validate(a.pid, { genuinelyLocal: true })?.tier).toBe(5);
  });
  it("revoking ANY holder's principal drops the shared pid for everyone; re-mint issues a new pid", () => {
    const live = new Set(["dev-A", "dev-B"]);
    const s = mk({ isPrincipalLive: (p) => live.has(p.deviceId ?? "") });
    const a = s.mint("vite-5173", A, { policy: pol });
    s.mint("vite-5173", B, { policy: pol });
    if (!a.ok) throw new Error("mint");
    live.delete("dev-B");
    expect(s.validate(a.pid, { genuinelyLocal: true })).toBeNull();
    const again = s.mint("vite-5173", A, { policy: pol });
    expect(again.ok && again.pid).not.toBe(a.pid);
  });
  it("a revocation-only holder admits nothing but still takes the pid down when revoked; a later mint upgrades it", () => {
    const live = new Set(["dev-A", "dev-B"]);
    const s = mk({ isPrincipalLive: (p) => live.has(p.deviceId ?? "") });
    const a = s.mint("vite-5173", A, { policy: pol });
    if (!a.ok) throw new Error("mint");
    expect(s.addRevocationHolder(a.pid, B)).toBe(true);
    expect(s.validate(a.pid, { genuinelyLocal: true })).not.toBeNull();
    live.delete("dev-B");
    expect(s.validate(a.pid, { genuinelyLocal: true })).toBeNull();
  });
  it("policy is the narrowest of the mint holders and never changes the pid", () => {
    const s = mk();
    const open = s.mint("vite-5173", A, { policy: { egress: "open", scripts: true } });
    if (!open.ok) throw new Error("mint");
    expect(s.validate(open.pid, { genuinelyLocal: true })?.policy).toEqual({ egress: "open", scripts: true });
    const narrow = s.mint("vite-5173", B, { policy: { egress: "restricted", scripts: true } });
    expect(narrow.ok && narrow.pid).toBe(open.pid);
    expect(s.validate(open.pid, { genuinelyLocal: true })?.policy).toEqual({ egress: "restricted", scripts: true });
    s.mint("vite-5173", LOCAL, { policy: { egress: "open", scripts: false } });
    expect(s.validate(open.pid, { genuinelyLocal: true })?.policy).toEqual({ egress: "restricted", scripts: false });
  });
  it("a localBound holder admits only genuinely local requests", () => {
    const s = mk();
    const m = s.mint("vite-5173", LOCAL, { policy: pol, localBound: true });
    if (!m.ok) throw new Error("mint");
    expect(s.validate(m.pid, { genuinelyLocal: false })).toBeNull();
    expect(s.validate(m.pid, { genuinelyLocal: true })).not.toBeNull();
    s.mint("vite-5173", A, { policy: pol }); // a second, unbound mint holder admits a remote request
    expect(s.validate(m.pid, { genuinelyLocal: false })).not.toBeNull();
  });
  it("idle 30 min / absolute 12 h; a request touches", () => {
    const s = mk();
    const m = s.mint("vite-5173", A, { policy: pol });
    if (!m.ok) throw new Error("mint");
    t += 29 * MIN;
    expect(s.validate(m.pid, { genuinelyLocal: true })).not.toBeNull();
    t += 29 * MIN;
    expect(s.validate(m.pid, { genuinelyLocal: true })).not.toBeNull();
    t += 31 * MIN;
    expect(s.validate(m.pid, { genuinelyLocal: true })).toBeNull();
    const m2 = s.mint("vite-5173", A, { policy: pol });
    if (!m2.ok) throw new Error("mint");
    for (let i = 0; i < 12; i++) {
      t += 59 * MIN;
      s.validate(m2.pid, { genuinelyLocal: true });
    }
    expect(s.validate(m2.pid, { genuinelyLocal: true })).toBeNull(); // > 12 h absolute
  });
  it("a mint inside the last 20 minutes issues a NEW pid; the superseded pid keeps serving until its own expiry and is never re-returned", () => {
    const s = mk();
    const first = s.mint("vite-5173", A, { policy: pol });
    if (!first.ok) throw new Error("mint");
    for (let i = 0; i < 24; i++) {
      t += 29 * MIN;
      s.validate(first.pid, { genuinelyLocal: true }); // keep alive (idle 30 min)
    }
    t += 10 * MIN; // 11 h 46 min of 12 h: inside the last 20 min
    s.validate(first.pid, { genuinelyLocal: true });
    const second = s.mint("vite-5173", A, { policy: pol });
    if (!second.ok) throw new Error("mint");
    expect(second.pid).not.toBe(first.pid);
    expect(second.restartRequired).toBe(true);
    expect(s.validate(first.pid, { genuinelyLocal: true })).not.toBeNull(); // superseded still serves
    const third = s.mint("vite-5173", B, { policy: pol });
    expect(third.ok && third.pid).toBe(second.pid); // never the superseded one
    t += 31 * MIN;
    expect(s.validate(first.pid, { genuinelyLocal: true })).toBeNull();
  });
  it("bounds: 32 per principal, 256 total — refused, never evicted; joining at the cap is allowed", () => {
    const s = mk();
    const pids: string[] = [];
    for (let i = 0; i < 32; i++) {
      const m = s.mint(`t-${i}`, A, { policy: pol });
      if (!m.ok) throw new Error("mint");
      pids.push(m.pid);
    }
    expect(s.mint("t-32", A, { policy: pol })).toEqual({ ok: false, reason: "principal-cap" });
    expect(s.mint("t-0", B, { policy: pol }).ok).toBe(true); // joining creates no pid
    expect(s.validate(pids[0], { genuinelyLocal: true })).not.toBeNull(); // nothing evicted
    for (let p = 0; s.size() < 256; p++) for (let i = 0; i < 32 && s.size() < 256; i++) s.mint(`u-${p}-${i}`, { kind: "device", deviceId: `d${p}` }, { policy: pol });
    expect(s.mint("overflow", { kind: "device", deviceId: "fresh" }, { policy: pol })).toEqual({ ok: false, reason: "total-cap" });
  });
  it("disabled previews / removed target drop every pid", () => {
    let enabled = true;
    let live = true;
    const s = mk({ isEnabled: () => enabled, isTargetLive: () => live });
    const a = s.mint("vite-5173", A, { policy: pol });
    if (!a.ok) throw new Error("mint");
    live = false;
    expect(s.validate(a.pid, { genuinelyLocal: true })).toBeNull();
    live = true;
    const b = s.mint("vite-5173", A, { policy: pol });
    if (!b.ok) throw new Error("mint");
    enabled = false;
    s.sweep();
    expect(s.size()).toBe(0);
  });
  it("malformed pid shapes are never looked up", () => {
    const s = mk();
    for (const bad of ["", "x", "A".repeat(21), "A".repeat(23), "A".repeat(21) + "*"]) expect(s.validate(bad, { genuinelyLocal: true })).toBeNull();
  });
});

describe("tier 5 over HTTP — forwarding, CORS null, WS, guard, mint route", () => {
  class Upstream {
    readonly seen: Array<{ url?: string; origin?: string; host?: string }> = [];
    readonly upgrades: Array<{ url?: string; origin?: string }> = [];
    readonly server: http.Server;
    readonly sockets = new Set<Socket>();
    port = 0;
    constructor() {
      this.server = http.createServer((req, res) => {
        this.seen.push({ url: req.url, origin: req.headers.origin, host: req.headers.host });
        if (req.url?.includes("/redir-in")) {
          res.writeHead(302, { location: `${req.url.split("/redir-in")[0]}/landed` });
          return res.end();
        }
        if (req.url?.includes("/cors")) {
          res.writeHead(200, { "access-control-allow-origin": "*", "access-control-allow-credentials": "true", vary: "Accept-Encoding, Origin" });
          return res.end("cors");
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      });
      this.server.on("upgrade", (req, socket) => {
        this.upgrades.push({ url: req.url, origin: req.headers.origin });
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
      });
      this.server.on("connection", (s) => {
        this.sockets.add(s);
        s.on("close", () => this.sockets.delete(s));
      });
    }
    async start() {
      await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
      this.port = (this.server.address() as AddressInfo).port;
    }
    async stop() {
      for (const s of this.sockets) s.destroy();
      await new Promise<void>((r) => this.server.close(() => r()));
    }
  }

  let up: Upstream;
  let app: FastifyInstance;
  let paths: PreviewPathStore;
  let store: LiveCapabilityStore;
  let pid: string;
  let guardDenials: string[];
  const target = () => ({ id: "vite-5173", label: "v", host: "127.0.0.1", port: up.port });

  beforeEach(async () => {
    up = new Upstream();
    await up.start();
    guardDenials = [];
    const manager = {
      get: (id: string) => (id === "vite-5173" ? target() : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    paths = new PreviewPathStore();
    store = new LiveCapabilityStore({ isTargetLive: () => true });
    app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createPreviewPreflight(() => paths));
    app.addHook("onRequest", createLiveCapabilityHook(store, paths));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: () => [], logDenial: (e) => guardDenials.push(e.path ?? "") }));
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, previewPaths: paths, previewOrigins: () => ({ enabled: true, tiers: [1, 5], issues: [] }), log: () => {} });
    registerLiveServerProxy(app, manager);
    app.get("/api/sessions", async () => ({ ok: true }));
    await app.listen({ port: 0, host: "127.0.0.1" });
    const m = paths.mint("vite-5173", A, { policy: pol });
    if (!m.ok) throw new Error("mint");
    pid = m.pid;
  });
  afterEach(async () => {
    for (const s of up.sockets) s.destroy();
    await app.close();
    await up.stop();
  });
  const port = () => (app.server.address() as AddressInfo).port;
  const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const r = http.request({ host: "127.0.0.1", port: port(), path, method, headers }, (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      r.on("error", reject);
      r.end();
    });

  it("forwards the FULL /preview/<pid>/… path (no strip) with a CSP that is path-scoped and opaque-sandboxed", async () => {
    const r = await get(`/preview/${pid}/app.js?x=1`);
    expect(r.status).toBe(200);
    expect(up.seen[0].url).toBe(`/preview/${pid}/app.js?x=1`);
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).not.toContain("allow-same-origin");
    // T11 (F26): `'self'` never matches the opaque parent of a same-pid nested pane, so tier 5 omits frame-ancestors.
    expect(csp).not.toContain("frame-ancestors");
    expect(csp).toContain(`frame-src http://127.0.0.1:${port()}/preview/${pid}/`);
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
  });
  it("a bare /preview/<pid> is forwarded too", async () => {
    expect((await get(`/preview/${pid}`)).status).toBe(200);
    expect(up.seen[0].url).toBe(`/preview/${pid}`);
  });
  it("unknown pid and refused raw paths are 404 and never reach the upstream", async () => {
    for (const p of [`/preview/${"B".repeat(22)}/x`, `/preview/${pid}/../api/sessions`, `/preview/${pid}/%2e%2e/x`, `/preview/${pid}/a%5Cb`, "/preview/short/x"]) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
    }
    expect(up.seen).toEqual([]);
  });
  it("a Location already inside the prefix is not prefixed again", async () => {
    const r = await get(`/preview/${pid}/redir-in`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`/preview/${pid}/landed`);
  });
  it("E130: ACAO null only on a valid /preview/<pid>/ response; never /api; upstream CORS overwritten (E132)", async () => {
    const ok = await get(`/preview/${pid}/app.js`, { origin: "null" });
    expect(ok.headers["access-control-allow-origin"]).toBe("null");
    expect(ok.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(ok.headers.vary).toContain("Origin");
    const up2 = await get(`/preview/${pid}/cors`, { origin: "null" });
    expect(up2.headers["access-control-allow-origin"]).toBe("null");
    expect(up2.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(String(up2.headers.vary).match(/origin/gi)?.length).toBe(1);
    const other = await get(`/preview/${"B".repeat(22)}/app.js`, { origin: "null" });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const api = await get("/api/sessions", { origin: "null" });
    expect(api.headers["access-control-allow-origin"]).toBeUndefined();
    const noOrigin = await get(`/preview/${pid}/app.js`);
    expect(noOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("E130: preflight is answered 204 for a valid pid only, without credentials", async () => {
    const pre = await get(`/preview/${pid}/api`, { origin: "null", "access-control-request-method": "POST", "access-control-request-headers": "content-type" }, "OPTIONS");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe("null");
    expect(pre.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(pre.headers["access-control-allow-headers"]).toBe("content-type");
    expect(up.seen).toEqual([]); // answered here, not forwarded
    const bad = await get(`/preview/${"B".repeat(22)}/api`, { origin: "null" }, "OPTIONS");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const dash = await get("/api/sessions", { origin: "null" }, "OPTIONS");
    expect(dash.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("E144: /preview/ is in the guard's jurisdiction — an untrusted caller without a live pid never reaches the proxy", async () => {
    const r = await get("/preview/short/x");
    expect([403, 404]).toContain(r.status);
    expect(up.seen).toEqual([]);
  });
  it("mint route: a tier-5 outcome returns /preview/<pid>/ without origin; a second principal gets the same pid", async () => {
    const mint = (accept: unknown) =>
      app.inject({ method: "POST", url: "/api/live-server/vite-5173/capability", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000" }, payload: { accept } });
    const r = (await mint(["preview"])).json();
    expect(r).toMatchObject({ success: true, tier: 5 });
    expect(r.path).toBe(`/preview/${pid}/`);
    expect(r.origin).toBeUndefined();
    for (const k of ["expiresAt", "tokenId", "policy"]) expect(r[k], k).toBeDefined();
    expect((await mint(["origin"])).json().tier).toBe(1); // a local peer on localhost still gets its tier 1
    expect((await mint(undefined)).json().tier).toBe("legacy");
  });
  it("E143/WS: an admitted upgrade under a valid pid pipes the FULL path (Origin dropped); a bad pid is closed", async () => {
    const manager = { get: (id: string) => (id === "vite-5173" ? target() : undefined), getStatic: () => undefined, use: () => {} } as unknown as LiveServerManager;
    app.server.on("upgrade", (req, socket, head) => {
      const p = parsePreviewPath(req.url);
      const g = p ? paths.validate(p.pid, { genuinelyLocal: true }) : null;
      if (!g) return void socket.destroy();
      handleLiveServerUpgrade(manager, req, socket, head, { previewTargetId: g.targetId });
    });
    const dial = (path: string) =>
      new Promise<string>((resolve) => {
        const s = net.connect(port(), "127.0.0.1", () =>
          s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port()}\r\nOrigin: null\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`),
        );
        let buf = "";
        s.on("data", (c) => {
          buf += c.toString();
          if (buf.includes("\r\n\r\n")) s.destroy();
        });
        s.on("close", () => resolve(buf));
        s.on("error", () => resolve(buf));
      });
    expect(await dial(`/preview/${pid}/ws?x=1`)).toContain("101 Switching Protocols");
    expect(up.upgrades[0]).toEqual({ url: `/preview/${pid}/ws?x=1`, origin: undefined });
    expect(await dial(`/preview/${"B".repeat(22)}/ws`)).toBe("");
    expect(await dial(`/preview/${pid}/../ws`)).toBe("");
    expect(up.upgrades).toHaveLength(1);
  });
});
