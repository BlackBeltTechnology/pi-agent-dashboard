/**
 * Host/listener dispatch (D3): preview-shaped Hosts are answered by the route-less `previewApp`, never by the
 * dashboard; label refusals are one opaque 403; upgrades are routed before any dashboard gate.
 *
 * Real HTTP (not `app.inject`, which bypasses the `serverFactory` wrapper) against a real upstream.
 *
 * See change: serve-live-previews-on-capability-origin (D3; test-plan #E43, #E44, #E45, #E46, #E137-#E139, #E142, #P1).
 */
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import net from "node:net";
import type { ResolvedPreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CapabilityPrincipal, LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { createPreviewDispatch, type PreviewDispatch, type PreviewRefusalReason, previewServerFactory } from "../live-server/preview-dispatch.js";

const principal: CapabilityPrincipal = { kind: "session", tier: "control", sessionKey: "s1" };
const resolved = (over: Partial<ResolvedPreviewOrigins> = {}): ResolvedPreviewOrigins => ({
  enabled: true,
  tiers: [1],
  issues: [],
  ...over,
});

interface Seen {
  url?: string;
  host?: string;
  origin?: string;
  cookie?: string;
  method?: string;
  body?: string;
}

class Upstream {
  readonly seen: Seen[] = [];
  readonly upgrades: Seen[] = [];
  readonly server: http.Server;
  private readonly sockets = new Set<Socket>();
  port = 0;
  constructor() {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        this.seen.push({
          url: req.url,
          host: req.headers.host,
          origin: req.headers.origin as string | undefined,
          cookie: req.headers.cookie,
          method: req.method,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("upstream-404");
      });
    });
    this.server.on("upgrade", (req, socket) => {
      this.upgrades.push({ url: req.url, host: req.headers.host, origin: req.headers.origin as string | undefined });
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

const manager = (port: () => number): LiveServerManager =>
  ({
    get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: port() } : undefined),
    getStatic: () => undefined,
    use: () => {},
  }) as unknown as LiveServerManager;

function request(port: number, opts: { host?: string | string[]; path?: string; method?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const headers: Record<string, string | string[]> = { ...(opts.headers ?? {}) };
    if (opts.host !== undefined) headers.host = opts.host;
    const req = http.request({ host: "127.0.0.1", port, path: opts.path ?? "/", method: opts.method ?? "GET", headers, setHost: false }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

/** Raw request so duplicate / odd Host headers survive. */
function raw(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(`${lines.join("\r\n")}\r\n\r\n`));
    let buf = "";
    s.on("data", (c) => {
      buf += c.toString();
    });
    s.on("close", () => resolve(buf));
    s.on("error", () => resolve(buf));
    setTimeout(() => s.destroy(), 1500).unref();
  });
}

describe("preview dispatch (D3)", () => {
  let upstream: Upstream;
  let store: LiveCapabilityStore;
  let dispatch: PreviewDispatch;
  let app: FastifyInstance;
  let port: number;
  let dashboardHits: string[];
  let refused: PreviewRefusalReason[];
  let upgradeSeen: string[];
  let shape: ResolvedPreviewOrigins;
  let enabled: boolean;
  let peerLocal: boolean;
  let label: string;
  let mintedAt: number;
  const conns = new Set<Socket>();

  beforeEach(async () => {
    upstream = new Upstream();
    await upstream.start();
    shape = resolved();
    enabled = true;
    peerLocal = true;
    dashboardHits = [];
    refused = [];
    upgradeSeen = [];
    store = new LiveCapabilityStore({ now: () => mintedAt });
    mintedAt = 1_000_000;
    dispatch = createPreviewDispatch({
      store,
      manager: manager(() => upstream.port),
      isPeerLocal: () => peerLocal,
      shape: { resolved: shape, classify: (h) => (h === "myapp.localhost" ? "allowedHosts" : null) },
      enabled: () => enabled,
      onRefused: (r) => refused.push(r),
    });
    app = Fastify({ logger: false, serverFactory: previewServerFactory(() => dispatch) as never });
    app.addHook("onRequest", async (req) => {
      dashboardHits.push(req.url);
    });
    app.get("/api/health", async () => ({ dashboard: true }));
    app.get("/", async () => "<html>spa</html>");
    await dispatch.ready();
    await app.listen({ port: 0, host: "127.0.0.1" });
    port = (app.server.address() as AddressInfo).port;
    app.server.on("connection", (s) => {
      conns.add(s);
      s.on("close", () => conns.delete(s));
    });
    app.server.on("upgrade", (req, socket, head) => {
      if (dispatch.handleUpgrade(req, socket, head)) return;
      upgradeSeen.push(req.url ?? "");
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
    });
    const m = store.mint("vite-5173", principal, {
      preview: {
        tier: 1,
        ancestors: ["http://localhost:8000"],
        buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }),
      },
    });
    label = m.token;
  });

  afterEach(async () => {
    for (const c of conns) c.destroy();
    await app.close();
    await dispatch.close();
    await upstream.stop();
  });

  it("E43: a preview Host never reaches dashboard routing (api, auth, plugins, SPA, csp-report)", async () => {
    for (const p of ["/api/health", "/api/sessions", "/auth/logout", "/", "/api/plugins/x/public/y", "/ws"]) {
      const r = await request(port, { host: `${label}.localhost:8000`, path: p, headers: { cookie: "pi_dash_token=abc; app=1" } });
      expect(r.status, p).toBe(404);
      expect(r.body, p).toBe("upstream-404");
    }
    expect(dashboardHits).toEqual([]);
    expect(upstream.seen.map((s) => s.url)).toEqual(["/api/health", "/api/sessions", "/auth/logout", "/", "/api/plugins/x/public/y", "/ws"]);
    // the dashboard credential is stripped, the app's own cookie passes
    expect(upstream.seen[0].cookie).toBe("app=1");
    expect(upstream.seen[0].host).toBe(`127.0.0.1:${upstream.port}`);
  });

  it("E43: a normal Host still reaches the dashboard", async () => {
    const r = await request(port, { host: `localhost:${port}`, path: "/api/health" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ dashboard: true });
    expect(dashboardHits).toEqual(["/api/health"]);
  });

  it("forwards method, body and rewrites Origin to the upstream origin (opaque null kept)", async () => {
    await request(port, { host: `${label}.localhost:8000`, path: "/x?q=1", method: "POST", headers: { origin: `http://${label}.localhost:8000`, "content-type": "application/json" }, body: '{"a":1}' });
    await request(port, { host: `${label}.localhost:8000`, path: "/y", method: "POST", headers: { "content-type": "application/octet-stream" }, body: "rawbytes" });
    await request(port, { host: `${label}.localhost:8000`, path: "/z", headers: { origin: "null" } });
    expect(upstream.seen[0]).toMatchObject({ url: "/x?q=1", method: "POST", origin: `http://127.0.0.1:${upstream.port}` });
    expect(JSON.parse(upstream.seen[0].body ?? "")).toEqual({ a: 1 });
    expect(upstream.seen[1].body).toBe("rawbytes");
    expect(upstream.seen[2].origin).toBe("null");
  });

  it("E44: Host forms — case and trailing dot admitted; wrong port, no port, unknown refused opaquely", async () => {
    const ok = [`${label.toUpperCase()}.LOCALHOST:8000`, `${label}.localhost.:8000`];
    for (const h of ok) expect((await request(port, { host: h })).status, h).toBe(404); // upstream's 404 = proxied
    for (const h of [`${label}.localhost:80`, `${label}.localhost`, `${"a".repeat(26)}.localhost:8000`]) {
      const r = await request(port, { host: h });
      expect(r.status, h).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ error: "host_not_allowed" });
      expect(r.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(dashboardHits).toEqual([]);
    expect(refused).toEqual(["wrong-port", "wrong-port", "unknown"]);
  });

  it("E44: duplicate Host and userinfo forms are never dashboard-routed or proxied", async () => {
    const dup = await raw(port, ["GET /api/health HTTP/1.1", `Host: ${label}.localhost:8000`, "Host: localhost", "Connection: close"]);
    expect(dup).not.toContain('"dashboard":true');
    expect(dup).not.toContain("upstream-404");
    const ui = await raw(port, ["GET /api/health HTTP/1.1", `Host: ${label}.localhost:8000@evil.com`, "Connection: close"]);
    expect(ui).not.toContain('"dashboard":true');
    expect(ui).not.toContain("upstream-404");
    expect(dashboardHits).toEqual([]);
    expect(upstream.seen).toEqual([]);
  });

  it("E45: non-label .localhost and near-miss labels stay with the dashboard", async () => {
    for (const h of ["myapp.localhost:8000", `${"a".repeat(25)}.localhost`, `${"a".repeat(27)}.localhost`, `${"a".repeat(25)}1.localhost`, `x.${label}.localhost`]) {
      const r = await request(port, { host: h, path: "/api/health" });
      expect(r.status, h).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ dashboard: true });
    }
    expect(upstream.seen).toEqual([]);
  });

  it("E46/E137: unknown, expired and disabled label hosts get the same opaque 403, in any mode", async () => {
    const other = "b".repeat(26);
    const bodies = new Set<string>();
    const a = await request(port, { host: `${other}.localhost:8000` });
    bodies.add(a.body);
    mintedAt += 13 * 60 * 60_000; // past the max lifetime
    const b = await request(port, { host: `${label}.localhost:8000` });
    bodies.add(b.body);
    enabled = false;
    const c = await request(port, { host: `${label}.localhost:8000` });
    bodies.add(c.body);
    expect([a.status, b.status, c.status]).toEqual([403, 403, 403]);
    expect(bodies.size).toBe(1);
    expect(refused).toEqual(["unknown", "expired", "disabled"]);
    expect(dashboardHits).toEqual([]);
  });

  it("E139: exactness — a tier-1 entry is not served to a non-local peer, nor on another host", async () => {
    peerLocal = false;
    expect((await request(port, { host: `${label}.localhost:8000` })).status).toBe(403);
    peerLocal = true;
    expect((await request(port, { host: `${label}.localhost:8000` })).status).toBe(404);
    expect((await request(port, { host: `${label}.preview.example.com` })).status).toBe(200); // not shaped without a wildcard: dashboard
  });

  it("wildcard-shaped hosts stay preview-shaped even when previews are disabled (Q11)", async () => {
    shape.wildcard = { suffix: "preview.example.com" } as never;
    enabled = false;
    const r = await request(port, { host: `${label}.preview.example.com` });
    expect(r.status).toBe(403);
    expect(dashboardHits).toEqual([]);
  });

  it("E142: a preview upgrade is served by the preview branch (Origin policy is the preview's own); a dashboard upgrade falls through", async () => {
    const req = (host: string) =>
      raw(port, ["GET /ws HTTP/1.1", `Host: ${host}`, "Connection: Upgrade", "Upgrade: websocket", "Origin: http://attacker.example", "Sec-WebSocket-Key: x", "Sec-WebSocket-Version: 13"]);
    const viaPreview = await req(`${label}.localhost:8000`);
    expect(viaPreview).toContain("101 Switching Protocols");
    expect(upstream.upgrades).toHaveLength(1);
    expect(upstream.upgrades[0].host).toBe(`127.0.0.1:${upstream.port}`);
    expect(upstream.upgrades[0].origin).toBeUndefined();
    expect(upgradeSeen).toEqual([]);
    const viaDash = await req(`localhost:${port}`);
    expect(viaDash).toContain("403");
    expect(upgradeSeen).toEqual(["/ws"]);
    const unknown = await req(`${"c".repeat(26)}.localhost:8000`);
    expect(unknown).toContain("403");
    expect(upgradeSeen).toEqual(["/ws"]); // the unknown label never reached the dashboard branch
  });

  it("P1: the dispatch decision is cheap and does not scan entries (1,024 live entries)", async () => {
    const reqOf = (host: string) => ({ headers: { host }, socket: {} }) as unknown as http.IncomingMessage;
    const time = (n: number) => {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < n; i++) dispatch.isPreviewRequest(reqOf(`localhost:${port}`));
      return Number(process.hrtime.bigint() - t0);
    };
    time(2000);
    const base = time(20_000);
    for (let i = 0; i < 1024; i++) {
      store.mint(`t-${i}`, { kind: "session", tier: "control", sessionKey: `s-${i}` }, {
        preview: {
          tier: 1,
          ancestors: ["http://localhost:8000"],
          buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }),
        },
      });
    }
    const loaded = time(20_000);
    expect(loaded).toBeLessThan(base * 1.2 + 5_000_000);
  });

  it("X3: an uninitialised or throwing dispatcher fails CLOSED for label hosts — never the dashboard", async () => {
    let current: PreviewDispatch | undefined;
    const app2 = Fastify({ logger: false, serverFactory: previewServerFactory(() => current) as never });
    const hits: string[] = [];
    app2.addHook("onRequest", async (r) => {
      hits.push(r.url);
    });
    app2.get("/api/health", async () => ({ dashboard: true }));
    await app2.listen({ port: 0, host: "127.0.0.1" });
    const p2 = (app2.server.address() as AddressInfo).port;
    try {
      const host = `${label}.localhost:8000`;
      expect((await request(p2, { host })).status).toBe(503); // not initialised
      current = { ...dispatch, handleRequest: () => { throw new Error("boom"); } };
      expect((await request(p2, { host })).status).toBe(503); // throws synchronously
      expect(hits).toEqual([]);
      expect((await request(p2, { host: `localhost:${p2}`, path: "/api/health" })).status).toBe(200);
      expect(hits).toEqual(["/api/health"]);
    } finally {
      await app2.close();
    }
  });

  it("X4: a dead upstream behind a label host is 502 (not 403, not the dashboard) and the dashboard stays served", async () => {
    await upstream.stop();
    const r = await request(port, { host: `${label}.localhost:8000` });
    expect(r.status).toBe(502);
    expect((await request(port, { host: `localhost:${port}`, path: "/api/health" })).status).toBe(200);
    await upstream.start(); // so afterEach's stop() is a no-op-safe close
  });

  it("E150/E151: a served preview response carries the entry-derived CSP (origin-root lists, exact ancestors)", async () => {
    const scripted = store.mint("vite-5173", { kind: "session", tier: "control", sessionKey: "s2" }, {
      policy: { scripts: true },
      preview: {
        tier: 1,
        ancestors: ["http://localhost:8000"],
        buildOrigin: (l) => ({ origin: `http://${l}.localhost:8000`, originHost: `${l}.localhost:8000` }),
      },
    }).token;
    const r = await request(port, { host: `${scripted}.localhost:8000`, path: "/app.js" });
    const csp = String(r.headers["content-security-policy"]);
    const origin = `http://${scripted}.localhost:8000`;
    expect(csp).toContain("sandbox allow-scripts allow-same-origin allow-forms");
    expect(csp).toContain(`frame-ancestors http://localhost:8000 ${origin}`);
    expect(csp).toContain(`connect-src ${origin}/ ws://${scripted}.localhost:8000/`);
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("report-uri /__pi/csp-report");
  });

  it("E155: a CSP report on the live preview origin is accepted; on an unknown label origin it is refused", async () => {
    const post = (host: string) =>
      request(port, { host, path: "/__pi/csp-report", method: "POST", headers: { "content-type": "application/csp-report" }, body: JSON.stringify({ "csp-report": { "blocked-uri": "https://evil.example" } }) });
    expect((await post(`${label}.localhost:8000`)).status).not.toBe(403);
    expect(upstream.seen.some((s) => s.url === "/__pi/csp-report")).toBe(false); // never forwarded upstream
    expect((await post(`${"d".repeat(26)}.localhost:8000`)).status).toBe(403);
  });
});
