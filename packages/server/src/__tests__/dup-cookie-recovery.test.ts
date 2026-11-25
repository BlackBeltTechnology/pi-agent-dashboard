/**
 * Duplicate `pi_dash_*` cookie refusal — recovery flows and lockout false positives.
 *
 *  T.E119  duplicated OAuth state cookie: refused, expired incl. `Path=/auth/`, retry completes sign-in
 *  T.E120  duplicated pairing cookie: refused, expired at `/`, retry reaches the handler once
 *  T.E128  distinct `pi_dash_pool_<port>` cookies are NOT duplicates; stripped only on forward
 *  T.E129  CLI / script clients: duplicated name → self-describing 400; cookie-less bridge / Bearer clients unaffected
 *
 * See change: serve-live-previews-on-capability-origin (D10; test-plan #E119, #E120, #E128, #E129).
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

const exchange = vi.fn(async () => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (exchange as any)(...a),
  fetchUserInfo: async () => ({ email: "u@example.com", name: "U", username: "u" }),
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { registerBearerAuth, registerDeviceSessionRoutes } from "../auth/bearer-auth.js";
import { DeviceNonceStore, DeviceStatusLimiter, RevokedAnswerLog } from "../auth/device-proof.js";
import { createDuplicateCookieGate, DuplicateCookieLog } from "../auth/duplicate-cookie-gate.js";
import { ensureServerIdentity } from "../auth/identity.js";
import { createNetworkGuard, createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { createLiveServerManager } from "../live-server/live-server-manager.js";
import { registerLiveServerProxy } from "../live-server/live-server-proxy.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";
import { PUBLIC_PAIRING_PREFIXES, registerPairingRoutes } from "../routes/pairing-routes.js";
import { proofFetch, withLocalProof } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const quietLog = () => new DuplicateCookieLog(() => {});
const setCookies = (res: { headers: Record<string, any> }) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const expired = (res: { headers: Record<string, any> }, name: string) =>
  setCookies(res).filter((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c));
const pathsOf = (lines: string[]) => lines.map((l) => /Path=([^;]+)/.exec(l)?.[1]);

// ─── T.E119 — OAuth state cookie ───────────────────────────────────────────────────────────────────

describe("T.E119 — duplicated OAuth state cookie is recoverable", () => {
  const SECRET = "test-secret-32-chars-long-abcdef";
  let app: FastifyInstance;

  beforeEach(async () => {
    exchange.mockClear();
    app = Fastify();
    // the same order as server.ts: the duplicate-cookie gate, then the auth plugin
    app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: quietLog() }));
    await registerAuthPlugin(app, {
      authConfig: { secret: SECRET, providers: { github: { clientId: "cid", clientSecret: "cs" } }, allowedUsers: ["*@example.com"] } as AuthConfig,
      port: 8000,
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const start = async () => {
    const res = await app.inject({ method: "GET", url: "/auth/login?return=%2Fsessions" });
    const stateCookie = setCookies(res).find((c) => c.startsWith("pi_dash_oauth_state="))!;
    // /auth/login with one provider redirects to the IdP; `state` rides the Location
    const state = new URL(res.headers.location as string).searchParams.get("state")!;
    return { state, cookie: stateCookie.split(";")[0]! };
  };

  it("GET /auth/callback/github with pi_dash_oauth_state ×2 → 400, expiry incl. Path=/auth/, handler not run; retry from /auth/login signs in", async () => {
    const first = await start();
    const planted = "pi_dash_oauth_state=planted.deadbeef";
    const refused = await app.inject({
      method: "GET",
      url: `/auth/callback/github?code=c&state=${first.state}`,
      headers: { cookie: `${first.cookie}; ${planted}`, accept: "application/json" },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_oauth_state" });
    const lines = expired(refused, "pi_dash_oauth_state");
    expect(pathsOf(lines)).toEqual(expect.arrayContaining(["/", "/auth/", "/api/", "/auth/callback/github"]));
    // the callback handler never ran: no code exchange, no session cookie, no state-consuming redirect
    expect(exchange).not.toHaveBeenCalled();
    expect(setCookies(refused).some((c) => c.startsWith("pi_dash_token="))).toBe(false);
    expect(refused.headers.location).toBeUndefined();

    // recovery: the browser applied the expiry, the user starts over from /auth/login with ONE cookie
    const retry = await start();
    const done = await app.inject({ method: "GET", url: `/auth/callback/github?code=c&state=${retry.state}`, headers: { cookie: retry.cookie } });
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe("/sessions");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(setCookies(done).some((c) => c.startsWith("pi_dash_token="))).toBe(true);
  });

  it("the HTML refusal (a browser navigation) carries the same expiry set", async () => {
    const first = await start();
    const refused = await app.inject({
      method: "GET",
      url: `/auth/callback/github?code=c&state=${first.state}`,
      headers: { cookie: `${first.cookie}; pi_dash_oauth_state=planted.x`, accept: "text/html" },
    });
    expect(refused.statusCode).toBe(400);
    expect(String(refused.headers["content-type"])).toMatch(/^text\/html/);
    expect(pathsOf(expired(refused, "pi_dash_oauth_state"))).toContain("/auth/");
    expect(exchange).not.toHaveBeenCalled();
  });
});

// ─── T.E120 — pairing cookie ───────────────────────────────────────────────────────────────────────

describe("T.E120 — duplicated pairing cookie is recoverable", () => {
  const REMOTE = "192.168.16.20";
  let tmp: string;
  let app: FastifyInstance;
  let mgr: PairingManager;
  let nonces: DeviceNonceStore;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dupcookie-pair-"));
    const identity = ensureServerIdentity(path.join(tmp, "identity.json"));
    const reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
    mgr = new PairingManager({ registry: reg, getFingerprint: () => identity.fingerprint, getReachableUrls: () => [] });
    nonces = new DeviceNonceStore();
    app = Fastify();
    // the duplicate-cookie gate is the first hook, as in server.ts (host gate aside)
    app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: quietLog() }));
    await app.register(fastifyCookie);
    app.decorateRequest("isAuthenticated", false);
    registerBearerAuth(app, { registry: reg });
    registerDeviceSessionRoutes(app, { registry: reg, isSecure: () => false });
    app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [] }));
    app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], getPairingPrefixes: () => PUBLIC_PAIRING_PREFIXES, logDenial: () => {} }));
    registerPairingRoutes(app, {
      networkGuard: createNetworkGuard([]),
      identity,
      pairing: mgr,
      registry: reg,
      hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "192.168.16.204" }),
      deviceNonces: nonces,
      deviceStatusLimiter: new DeviceStatusLimiter({ limit: 60, onTrip: () => {} }),
      revokedAnswerLog: new RevokedAnswerLog({ now: () => 0, emit: () => {} }),
    });
    await app.ready();
  });
  afterEach(async () => {
    mgr.dispose();
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const challenge = (headers: Record<string, string>) =>
    app.inject({ method: "POST", url: "/api/pair/challenge", remoteAddress: REMOTE, headers: { "content-type": "application/json", ...headers }, payload: { nonce: "n".repeat(16) } });

  it.each([
    ["no Origin", {}],
    ["same-origin Origin", { origin: "http://192.168.16.204:8000", host: "192.168.16.204:8000" }],
  ])("pi_dash_local ×2 (%s) → 400 + expiry of pi_dash_local at `/`; retry without the duplicate reaches the handler once", async (_label, extra) => {
    const refused = await challenge({ cookie: "pi_dash_local=a.b; pi_dash_local=c.d", ...extra });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_local" });
    expect(pathsOf(expired(refused, "pi_dash_local"))).toContain("/");
    // the challenge handler did not run: no device nonce was issued
    expect(nonces.size()).toBe(0);

    // the browser applied the expiry → the retry carries no (or one) cookie and reaches the normal handler
    const ok = await challenge({ cookie: "pi_dash_local=a.b", ...extra });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().success).toBe(true);
    expect(nonces.size()).toBe(1); // created once, not twice
    const again = await challenge({ ...extra });
    expect(again.statusCode).toBe(200);
    expect(nonces.size()).toBe(2);
  });
});

// ─── T.E128 — distinct pool cookies are not duplicates ────────────────────────────────────────────

describe("T.E128 — distinct pi_dash_pool_<port> cookies are not a duplicate", () => {
  let app: FastifyInstance;
  let upstream: http.Server;
  afterEach(async () => {
    await app?.close();
    await new Promise<void>((r) => upstream?.close(() => r()));
  });

  it("not refused on the dashboard listener; the dashboard handler sees all three; the previewed upstream sees none of them", async () => {
    // a loopback "previewed app" that echoes the Cookie header it receives
    upstream = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", () => r()));
    const upPort = (upstream.address() as net.AddressInfo).port;

    app = Fastify({ logger: false });
    app.addHook("onRequest", createDuplicateCookieGate({ tier2: () => false, log: quietLog() }));
    const prefs = (() => {
      let store: any[] = [];
      return { getLiveServers: () => store, setLiveServers: (t: any[]) => (store = t) } as any;
    })();
    const manager = createLiveServerManager(prefs);
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined });
    registerLiveServerProxy(app, manager);
    app.get("/dashboard-echo", async (req) => ({ cookie: req.headers.cookie ?? null }));
    await app.ready();

    const target = (await app.inject({ method: "POST", url: "/api/live-server/start", payload: { host: "127.0.0.1", port: upPort, label: "app" } })).json().data;
    const cookie = "pi_dash_token=a; pi_dash_pool_8101=k1; pi_dash_pool_8102=k2; app_session=keep";

    const dash = await app.inject({ method: "GET", url: "/dashboard-echo", headers: { cookie } });
    expect(dash.statusCode).toBe(200); // not refused: three distinct names
    expect(dash.json().cookie).toBe(cookie);

    const fwd = await app.inject({ method: "GET", url: `${target.path}x`, headers: { cookie } });
    expect(fwd.statusCode).toBe(200);
    // every pi_dash_* (token and both pool cookies) stripped on the forward; the app's own cookie survives byte-for-byte
    expect(fwd.json().cookie).toBe("app_session=keep");

    // the SAME pool name twice IS a duplicate
    const dup = await app.inject({ method: "GET", url: "/dashboard-echo", headers: { cookie: "pi_dash_pool_8101=k1; pi_dash_pool_8101=k2" } });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().cookie).toBe("pi_dash_pool_8101");
  });
});

// ─── T.E129 — CLI / script clients and bridges ─────────────────────────────────────────────────────

describe("T.E129 — lockout false positives: CLI / script client and bridge", () => {
  let handle: TestServerHandle | undefined;
  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  /** A raw HTTP/1.1 request with exactly the header lines given (`curl -b jar -H 'Cookie: …'` sends two Cookie lines). */
  function raw(port: number, headerLines: string[]): Promise<{ status: number; headers: string; body: string }> {
    return new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(`GET /api/health HTTP/1.1\r\nHost: localhost:${port}\r\n${headerLines.join("\r\n")}${headerLines.length ? "\r\n" : ""}Connection: close\r\n\r\n`));
      let buf = "";
      s.on("data", (c) => {
        buf += c.toString();
      });
      const done = () => {
        const [head, ...rest] = buf.split("\r\n\r\n");
        resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0), headers: head, body: rest.join("\r\n\r\n") });
      };
      s.on("close", done);
      s.on("error", done);
    });
  }

  it("a name twice via `-b jar` + `-H Cookie:` (two Cookie header lines) → 400 with self-describing JSON naming the cookie", async () => {
    handle = await createTestServer();
    const r = await raw(handle.httpPort, ["Cookie: pi_dash_token=jar", "Cookie: pi_dash_token=x", "Accept: application/json"]);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: "duplicate_dashboard_cookie", cookie: "pi_dash_token" });
    expect(r.headers).toMatch(/set-cookie: pi_dash_token=; Max-Age=0; Path=\//i);
    // the single-line form is refused identically
    const one = await raw(handle.httpPort, ["Cookie: pi_dash_token=jar; pi_dash_token=x"]);
    expect(one.status).toBe(400);
  });

  it("bridge / Bearer-only clients with no cookies are unaffected", async () => {
    handle = await createTestServer();
    const base = `http://127.0.0.1:${handle.httpPort}`;
    expect((await proofFetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/health`, { headers: { authorization: "Bearer not-a-real-device-token" } })).status).toBe(200);
    // a cookie that is NOT a dashboard name, repeated, is not ours to refuse
    expect((await fetch(`${base}/api/health`, { headers: { cookie: "theme=dark; theme=light" } })).status).toBe(200);
    // the loopback bridge gateway listener: a credentialed dial with no cookies registers/opens normally
    const opened = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${handle!.piPort}/`);
      ws.on("open", () => {
        ws.close();
        resolve("open");
      });
      ws.on("unexpected-response", (_q, res) => resolve(String(res.statusCode)));
      ws.on("error", () => resolve("error"));
      setTimeout(() => resolve("timeout"), 5000);
    });
    expect(opened).toBe("open");
  }, 30000);

  it("bridge local-token upgrade carrying a stray pi_dash_local ×2 → 400 head with expiry (no 101); the same upgrade without cookies carries no cookie-gate refusal", async () => {
    handle = await createTestServer();
    const port = handle.httpPort;
    const url = `ws://127.0.0.1:${port}/ws/bridge`;
    const dial = (cookie?: string) =>
      new Promise<{ kind: "open" | "status" | "error"; status?: number; setCookie?: string[] }>((resolve) => {
        const ws = new WebSocket(url, { headers: withLocalProof(url, cookie ? { cookie } : {}) });
        ws.on("open", () => {
          ws.terminate();
          resolve({ kind: "open" });
        });
        ws.on("unexpected-response", (_q, res) => {
          res.resume();
          resolve({ kind: "status", status: res.statusCode, setCookie: ([] as string[]).concat(res.headers["set-cookie"] ?? []) });
        });
        ws.on("error", () => resolve({ kind: "error" }));
        setTimeout(() => resolve({ kind: "error" }), 5000);
      });

    const refused = await dial("pi_dash_local=a.b; pi_dash_local=c.d");
    expect(refused.kind).toBe("status");
    expect(refused.status).toBe(400);
    expect(refused.setCookie?.some((c) => c.startsWith("pi_dash_local=; Max-Age=0; Path=/"))).toBe(true);

    // The bridge scope on the dashboard port has its own admission (ticket) and may answer a cookie-less dial
    // with its own refusal; what matters is that it is NOT the duplicate-cookie refusal: no expiry lines at all.
    const clean = await dial();
    expect(clean.setCookie ?? []).toEqual([]);
  }, 30000);
});
