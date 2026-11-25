/**
 * Tier 5 (`/preview/<pid>/`, D8) at the edges of the dashboard: opaque-origin CORS scoping (`ACAO: null`), the WS upgrade
 * Origin gate (real server), reserved / dropped / malformed upgrades, and the guard / route-tier jurisdiction.
 * See change: serve-live-previews-on-capability-origin (test-plan #E86, #E87, #E88, #X20).
 */
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authorizeWsUpgrade } from "../auth/auth-plugin.js";
import { isWsOriginTrusted } from "../auth/cors-origin.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { type CoreWsRouteScope, routeScopeForUrl } from "../auth/ws-ticket.js";
import { classifyHttpRoad } from "../identity/http-road-classification.js";
import { parsePreviewPath } from "../live-server/preview-path.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import { dev, type Harness, MIN, makeHarness, T0 } from "./helpers/preview-path-harness.js";

describe("T.E86 / #E86 — ACAO null scoping", () => {
  let h: Harness;
  let pid: string;
  let expired: string;
  beforeEach(async () => {
    h = await makeHarness({ cors: true });
    expired = (await h.mint(dev("E"), "vite-5173")).pid as string;
    h.clock.now = T0 + 31 * MIN; // past the 30-min idle expiry of the first pid
    h.paths.sweep();
    pid = (await h.mint(dev("A"))).pid as string;
    expect(pid).not.toBe(expired);
  });
  afterEach(async () => {
    await h.close();
  });

  const origins = ["null", "http://evil.example", undefined] as const;
  const paths = (): Array<[string, string]> => [
    ["valid pid", `/preview/${pid}/x`],
    ["unknown pid", `/preview/${"B".repeat(22)}/x`],
    ["expired pid", `/preview/${expired}/x`],
    ["/api/sessions", "/api/sessions"],
    ["/ws", "/ws"],
    ["/auth/x", "/auth/x"],
    ["/live/<id>/", "/live/vite-5173/"],
  ];
  const send = (path: string, origin: string | undefined, method: "GET" | "OPTIONS") =>
    h.get(path, { ...(origin ? { origin } : {}), ...(method === "OPTIONS" ? { "access-control-request-method": "POST", "access-control-request-headers": "content-type" } : {}) }, method);

  /** One matrix cell: the grant is `ACAO: null` (+ `Vary: Origin`, no ACAC) for (Origin null, valid pid) only. */
  const checkCell = async (method: "GET" | "OPTIONS", origin: string | undefined, name: string, path: string) => {
    const r = await send(path, origin, method);
    const label = `${method} Origin=${origin} ${name}`;
    const acao = r.headers["access-control-allow-origin"];
    if (!(origin === "null" && name === "valid pid")) {
      expect(acao, label).toBeUndefined();
      if (origin !== undefined) expect(r.headers["access-control-allow-credentials"], label).toBeUndefined();
      return;
    }
    expect(acao, label).toBe("null");
    expect(String(r.headers.vary).split(/,\s*/), label).toContain("Origin");
    expect(r.headers["access-control-allow-credentials"], label).toBeUndefined();
    expect(r.status, label).toBe(method === "OPTIONS" ? 204 : 200);
    if (method === "OPTIONS") expect(r.headers["access-control-allow-headers"], label).toBe("content-type");
  };

  it("T.E86 ACAO: null + Vary: Origin ONLY for (Origin null, valid pid), never ACAC; preflight of a valid pid is 204 from previewPreflight, an unknown pid gets no CORS headers", async () => {
    for (const method of ["GET", "OPTIONS"] as const) {
      for (const origin of origins) {
        for (const [name, path] of paths()) await checkCell(method, origin, name, path);
      }
    }
    // a preflight is answered here, never forwarded; unknown / expired pids answer nothing CORS-ish
    expect(h.up.seen.filter((s) => s.method === "OPTIONS" && s.headers.origin === "null")).toEqual([]);
  });

  it("T.E86 an upstream-supplied ACAO:* / ACAC:true is replaced by exactly `ACAO: null` (no credentials) for Origin null", async () => {
    const r = await h.get(`/preview/${pid}/cors`, { origin: "null" });
    expect(r.status).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("null");
    expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(String(r.headers.vary).match(/origin/gi)).toHaveLength(1);
  });

  it("T.E86 `Vary: Origin` is present on a valid pid even when the answer is absent (attacker / no Origin), including over an upstream's own Vary", async () => {
    for (const origin of ["http://evil.example", undefined]) {
      for (const path of ["x", "vary"]) {
        const r = await h.get(`/preview/${pid}/${path}`, origin ? { origin } : {});
        expect(r.status).toBe(200);
        expect(r.headers["access-control-allow-origin"], `${origin} ${path}`).toBeUndefined();
        expect(String(r.headers.vary).split(/,\s*/), `${origin} ${path}`).toContain("Origin");
      }
    }
    const withUpstreamVary = await h.get(`/preview/${pid}/vary`, { origin: "null" });
    expect(String(withUpstreamVary.headers.vary).split(/,\s*/)).toEqual(expect.arrayContaining(["Accept-Encoding", "Origin"]));
  });

  it("T.E86 non-null Origins are unchanged: a valid pid answers like any dashboard route", async () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:5173"]) {
      const onPid = await h.get(`/preview/${pid}/x`, { origin });
      const onApi = await h.get("/api/sessions", { origin });
      expect(onPid.headers["access-control-allow-origin"]).toBe(origin);
      expect(onPid.headers["access-control-allow-origin"]).toBe(onApi.headers["access-control-allow-origin"]);
    }
  });
});

describe("T.E87 / T.X20 — WS upgrade admission on a real server", () => {
  let handle: TestServerHandle;
  let upstream: http.Server;
  const upgrades: Array<{ url?: string; origin?: string }> = [];
  const upstreamSockets = new Set<net.Socket>();
  let validPid: string;
  let legacyPath: string;
  let targetId: string;
  let port: number;

  beforeAll(async () => {
    upstream = http.createServer((_q, r) => r.end("ok"));
    upstream.on("upgrade", (req, socket) => {
      upgrades.push({ url: req.url, origin: req.headers.origin });
      socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    });
    upstream.on("connection", (c) => {
      upstreamSockets.add(c);
      c.on("close", () => upstreamSockets.delete(c));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    handle = await createTestServer();
    port = handle.httpPort;
    const base = `http://127.0.0.1:${port}`;
    const json = { "content-type": "application/json" };
    const start = (await (await proofFetch(`${base}/api/live-server/start`, { method: "POST", headers: json, body: JSON.stringify({ host: "127.0.0.1", port: (upstream.address() as AddressInfo).port, label: "t" }) })).json()) as { data: { id: string } };
    targetId = start.data.id;
    const mint = async (body: object) => (await (await proofFetch(`${base}/api/live-server/${targetId}/capability`, { method: "POST", headers: json, body: JSON.stringify(body) })).json()) as { tier: unknown; path: string };
    const t5 = await mint({ accept: ["preview"] });
    expect(t5.tier).toBe(5);
    validPid = /^\/preview\/([A-Za-z0-9_-]{22})\/$/.exec(t5.path)?.[1] as string;
    const legacy = await mint({});
    expect(legacy.tier).toBe("legacy");
    legacyPath = legacy.path;
  }, 60_000);
  afterAll(async () => {
    for (const c of upstreamSockets) c.destroy();
    await handle?.stop();
    for (const c of upstreamSockets) c.destroy();
    await new Promise<void>((r) => upstream.close(() => r()));
  }, 60_000);

  /** Raw upgrade (no credential): the status line the server answers with, `""` when it closes silently. */
  const dial = (path: string, origin?: string): Promise<{ status: string; closed: boolean }> =>
    new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.write(
          `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${origin !== undefined ? `Origin: ${origin}\r\n` : ""}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${Buffer.from("0123456789abcdef").toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let buf = "";
      let closed = false;
      s.on("data", (c) => {
        buf += c.toString();
        if (buf.includes("\r\n\r\n")) {
          // a 4xx head is followed by a destroy: give the server a beat to close, then report
          setTimeout(() => s.destroy(), 150);
        }
      });
      s.on("close", () => {
        closed = true;
        resolve({ status: buf.split("\r\n")[0] ?? "", closed });
      });
      s.on("error", () => resolve({ status: buf.split("\r\n")[0] ?? "", closed }));
      setTimeout(() => {
        s.destroy();
        resolve({ status: `TIMEOUT:${buf.split("\r\n")[0]}`, closed });
      }, 5_000);
    });
  const OK = "HTTP/1.1 101 Switching Protocols";
  const FORBIDDEN = "HTTP/1.1 403 Forbidden";

  it("T.E87 scope × Origin matrix: /ws and /ws/terminal + null → 403; /preview/<valid>/ + null → admitted (scope live); /preview/<unknown>/ → 403; attacker Origin → 403 for all", async () => {
    const unknown = `/preview/${"B".repeat(22)}/ws`;
    const scopes: Array<[string, string, { null: string; attacker: string; absent: string }]> = [
      ["/ws", "/ws", { null: FORBIDDEN, attacker: FORBIDDEN, absent: FORBIDDEN }],
      ["/ws/terminal/:id", "/ws/terminal/term-x", { null: FORBIDDEN, attacker: FORBIDDEN, absent: FORBIDDEN }],
      ["/live/L", `${legacyPath}ws`, { null: OK, attacker: FORBIDDEN, absent: OK }],
      ["/preview/<valid>/", `/preview/${validPid}/ws`, { null: OK, attacker: FORBIDDEN, absent: OK }],
      ["/preview/<unknown>/", unknown, { null: FORBIDDEN, attacker: FORBIDDEN, absent: FORBIDDEN }],
    ];
    for (const [name, path, expected] of scopes) {
      for (const [originName, origin] of [["null", "null"], ["attacker", "http://attacker.example"], ["absent", undefined]] as const) {
        const r = await dial(path, origin);
        expect(r.status, `${name} Origin=${originName}`).toBe(expected[originName]);
        expect(r.closed, `${name} Origin=${originName} socket closed`).toBe(true);
      }
    }
  }, 60_000);

  it("T.E87 an admitted /preview/<valid>/ upgrade forwards the FULL path and never the browser's Origin", async () => {
    upgrades.length = 0;
    expect((await dial(`/preview/${validPid}/hmr?token=1`, "null")).status).toBe(OK);
    expect(upgrades).toEqual([{ url: `/preview/${validPid}/hmr?token=1`, origin: undefined }]);
  });

  it("T.X20 (a) unknown pid and (d) dot-segment / encoded paths: raw `HTTP/1.1 403`, socket destroyed, nothing forwarded", async () => {
    upgrades.length = 0;
    const bad = [
      `/preview/${"C".repeat(22)}/ws`,
      `/preview/${validPid}/../ws`,
      `/preview/${validPid}/./ws`,
      `/preview/${validPid}/a%2Fb`,
      `/preview/${validPid}/%2e%2e/ws`,
      `/preview/${validPid}/a%5Cb`,
      `/preview/${validPid}/a%00b`,
      `/preview/${validPid}/a\\b`,
    ];
    for (const path of bad) {
      for (const origin of ["null", undefined]) {
        const r = await dial(path, origin);
        expect(r.status, `${path} Origin=${origin}`).toBe(FORBIDDEN);
        expect(r.closed, `${path} closed`).toBe(true);
      }
    }
    expect(upgrades).toEqual([]);
    // the same pid still upgrades cleanly afterwards (a refused path does not poison it)
    expect((await dial(`/preview/${validPid}/ws`, "null")).status).toBe(OK);
  }, 60_000);
});

describe("T.X20 / #X20 (b) — a reserved-but-unadopted pid is an unknown pid at the upgrade", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  /** The decision chain of `server.ts`'s `onUpgrade` for a `live`-scope upgrade, built from the same production functions. */
  const decide = (url: string, origin: string | undefined, genuinelyLocal = true): "forward" | "403" => {
    const scope = routeScopeForUrl(url) as CoreWsRouteScope | null;
    const path = scope === "live" ? parsePreviewPath(url) : null;
    const grant = path ? h.paths.validate(path.pid, { genuinelyLocal }) : null;
    if (!isWsOriginTrusted(origin, `127.0.0.1:8000`, scope, { configuredOrigins: [], trustedNetworks: [], getTunnelUrl: () => null }, grant !== null)) return "403";
    const auth = authorizeWsUpgrade({
      remoteAddress: "203.0.113.5",
      secret: null,
      trustedNetworks: [],
      scope,
      headers: {},
      requireIdentityTicket: false,
      liveCapability: grant ? { identity: grant.principal.identity, identityExpiresAt: grant.principal.identityExpiresAt } : null,
    });
    return auth.ok && grant ? "forward" : "403";
  };

  it("T.X20 (b) reserved pid: HTTP 404 and upgrade 403 for null / absent Origin, identical to an unknown pid; adoption by a mint makes it live", async () => {
    h.bridges.add("S-B");
    const r = h.paths.reserve(h.up.port, { key: "bridge:S-B", isLive: () => h.bridges.has("S-B") });
    if (!r.ok) throw new Error("reservation refused");
    const unknown = "D".repeat(22);
    for (const origin of ["null", undefined]) {
      expect(decide(`/preview/${r.pid}/ws`, origin), `reserved Origin=${origin}`).toBe("403");
      expect(decide(`/preview/${unknown}/ws`, origin), `unknown Origin=${origin}`).toBe("403");
    }
    expect((await h.get(`/preview/${r.pid}/x`)).status).toBe(404);
    expect((await h.get(`/preview/${unknown}/x`)).status).toBe(404);
    expect(h.paths.validate(r.pid, { genuinelyLocal: true })).toBeNull();
    // a control-tier mint adopts it: the same pid is now admitted
    const m = await h.mint(dev("A"));
    expect(m.pid).toBe(r.pid);
    expect(decide(`/preview/${r.pid}/ws`, "null")).toBe("forward");
    expect(decide(`/preview/${r.pid}/ws`, "http://attacker.example")).toBe("403");
    expect(decide(`/preview/${r.pid}/../ws`, "null")).toBe("403");
  });
});

describe("T.E88 / #E88 — jurisdiction", () => {
  describe("classification", () => {
    it("T.E88 /preview/<pid>/ is classified like /live/ (non-session road, live.<verb>); prefix-confusion paths are not captured", () => {
      const pid = "A".repeat(22);
      for (const method of ["GET", "POST", "OPTIONS"]) {
        const live = classifyHttpRoad(method, `/live/vite-5173/x`);
        const prev = classifyHttpRoad(method, `/preview/${pid}/x`);
        expect(prev, method).toMatchObject({ road: "non-session", action: (live as { action: string }).action });
        expect(prev).toMatchObject({ resource: { kind: "live" } });
      }
      expect(classifyHttpRoad("GET", `/preview/${pid}`)).toMatchObject({ road: "non-session" });
      for (const other of ["/previewx/", `/previewx/${pid}/`, "/preview", "/Preview/x", "/previews/x", "/xpreview/x"]) {
        expect(classifyHttpRoad("GET", other), other).toBeUndefined();
      }
    });

    it("T.E88 the WS scope of /preview/ is `live` (same as /live/); prefix-confusion paths have no scope", () => {
      expect(routeScopeForUrl(`/preview/${"A".repeat(22)}/ws`)).toBe("live");
      expect(routeScopeForUrl("/live/x/ws")).toBe("live");
      for (const other of ["/previewx/ws", "/preview", "/Preview/x", "/xpreview/x"]) expect(routeScopeForUrl(other), other).toBeNull();
    });
  });

  describe("network guard", () => {
    let h: Harness;
    beforeEach(async () => {
      h = await makeHarness({ guard: { trusted: ["192.168.1.0/24"] } });
    });
    afterEach(async () => {
      await h.close();
    });
    const peers: Array<[string, string, Record<string, string>]> = [
      ["loopback", "127.0.0.1", {}],
      ["LAN peer outside the trusted network", "192.168.2.5", {}],
      ["trusted network", "192.168.1.20", {}],
      ["tunnel (loopback + forwarding header)", "127.0.0.1", { "x-forwarded-for": "198.51.100.7" }],
      ["public peer", "203.0.113.9", {}],
    ];
    const req = (url: string, ip: string, headers: Record<string, string>) => h.app.inject({ method: "GET", url, remoteAddress: ip, headers });

    it("T.E88 an untrusted peer without a live pid is refused (403) BEFORE the proxy, exactly like /live/; a trusted / loopback peer reaches the proxy's own 404", async () => {
      const unknown = `/preview/${"B".repeat(22)}/x`;
      const refused = new Set(["LAN peer outside the trusted network", "tunnel (loopback + forwarding header)", "public peer"]);
      for (const [name, ip, headers] of peers) {
        const live = await req("/live/unregistered/x", ip, headers);
        const prev = await req(unknown, ip, headers);
        expect(prev.statusCode, name).toBe(refused.has(name) ? 403 : 404);
        expect(prev.statusCode, `${name}: classified like /live/`).toBe(live.statusCode);
      }
      expect(h.up.seen).toEqual([]); // the proxy never forwarded any of them
      expect(h.guardDenials.filter((p) => p.startsWith("/preview/")).length).toBe(refused.size);
      expect(h.guardDenials.join(" ")).not.toContain("B".repeat(22)); // the denial log redacts the pid
    });

    it("T.E88 a live pid is the capability: any peer class reaches the upstream with it; /previewx/ and bare /preview are outside the jurisdiction (404, not 403)", async () => {
      const pid = (await h.mint(dev("A"))).pid as string;
      let n = 0;
      for (const [name, ip, headers] of peers) {
        const r = await req(`/preview/${pid}/x`, ip, headers);
        expect(r.statusCode, name).toBe(200);
        n++;
        expect(h.up.seen).toHaveLength(n);
      }
      for (const [name, ip, headers] of peers) {
        for (const other of ["/previewx/", `/previewx/${pid}/x`, "/preview"]) {
          const r = await req(other, ip, headers);
          expect(r.statusCode, `${name} ${other.replace(pid, "<pid>")}`).toBe(404);
        }
      }
      expect(h.up.seen).toHaveLength(n); // nothing mis-routed to the upstream
    });
  });

  describe("route-tier gate", () => {
    it("T.E88 `/preview/:pid/*` needs the same tier as `/live/:id/*`: an observe-tier device is refused on both, a control-tier device passes both", async () => {
      const app = Fastify({ logger: false });
      app.addHook("onRequest", async (r) => {
        const tier = r.headers["x-test-principal"];
        if (typeof tier === "string") {
          const q = r as unknown as Record<string, unknown>;
          q.isAuthenticated = true;
          q.authVia = "device";
          q.principalTier = tier;
          q.principalDeviceId = "dev-A";
        }
      });
      app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
      app.all("/live/:id/*", async () => ({ ok: true }));
      app.all("/preview/:pid/*", async () => ({ ok: true }));
      app.all("/preview/:pid", async () => ({ ok: true }));
      await app.ready();
      const pid = "A".repeat(22);
      const call = (url: string, tier: string) => app.inject({ method: "GET", url, remoteAddress: "203.0.113.5", headers: { "x-test-principal": tier } });
      for (const url of [`/preview/${pid}/x`, `/preview/${pid}`, "/live/vite-5173/x"]) {
        expect((await call(url, "observe")).statusCode, `observe ${url}`).toBe(403);
        expect((await call(url, "control")).statusCode, `control ${url}`).toBe(200);
      }
      await app.close();
    });
  });
});
