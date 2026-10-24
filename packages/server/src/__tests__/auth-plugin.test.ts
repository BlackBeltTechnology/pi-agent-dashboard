import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearAppMountRegistry, mountApp } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import { escapeHtml, isBypassed, validateWsUpgrade } from "../auth/auth-plugin.js";
import { isBypassedHost } from "../auth/localhost-guard.js";
import { networkOnlySnapshot } from "../auth/network-trust-telemetry.js";
import { admissionTrustedNetworks } from "../auth/trust-mode.js";
import { type TrustModeHome, useTrustModeHome } from "../test-support/trust-mode-home.js";

const SECRET = "test-secret-for-ws-auth-testing";

describe("validateWsUpgrade", () => {
  it("should allow localhost without cookie", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::ffff:127.0.0.1", SECRET)).toBe(true);
  });

  it("should reject external request without cookie", () => {
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET)).toBe(false);
  });

  it("should reject external request with invalid cookie", () => {
    expect(validateWsUpgrade(`${COOKIE_NAME}=invalidtoken`, "1.2.3.4", SECRET)).toBe(false);
  });

  it("should allow external request with valid cookie", () => {
    const token = signToken({ sub: "user@example.com", name: "User", username: "user", provider: "github" }, SECRET);
    expect(validateWsUpgrade(`${COOKIE_NAME}=${token}`, "1.2.3.4", SECRET)).toBe(true);
  });

  it("should reject external request with wrong secret", () => {
    const token = signToken({ sub: "user@example.com", name: "User", username: "user", provider: "github" }, "other-secret");
    expect(validateWsUpgrade(`${COOKIE_NAME}=${token}`, "1.2.3.4", SECRET)).toBe(false);
  });
});

describe("isBypassed", () => {
  it("should return false for empty bypassUrls list", () => {
    expect(isBypassed("/api/sessions", [])).toBe(false);
  });

  it("should return true when URL starts with a bypass prefix", () => {
    expect(isBypassed("/webhooks/github", ["/webhooks/"])).toBe(true);
  });

  it("should return false when URL does not start with any bypass prefix", () => {
    expect(isBypassed("/api/sessions", ["/webhooks/"])).toBe(false);
  });

  it("should match multiple prefixes", () => {
    expect(isBypassed("/metrics", ["/webhooks/", "/metrics"])).toBe(true);
    expect(isBypassed("/healthz/ready", ["/healthz", "/metrics"])).toBe(true);
  });

  it("should match because startsWith is a prefix check (not word-boundary)", () => {
    // /api/public IS a prefix of /api/publications — this is expected, documented behaviour
    expect(isBypassed("/api/publications", ["/api/public"])).toBe(true);
  });

  it("should not match when prefix is only a substring in the middle", () => {
    expect(isBypassed("/v1/webhooks/data", ["/webhooks/"])).toBe(false);
  });

  it("should return false when no prefix matches", () => {
    expect(isBypassed("/secure/data", ["/webhooks/", "/metrics"])).toBe(false);
  });
});

describe("isBypassedHost", () => {
  it("should return false for empty bypass list", () => {
    expect(isBypassedHost("10.0.0.5", [])).toBe(false);
  });

  it("should match exact IP", () => {
    expect(isBypassedHost("10.0.0.5", ["10.0.0.5"])).toBe(true);
  });

  it("should match exact hostname", () => {
    expect(isBypassedHost("build-server.local", ["build-server.local"])).toBe(true);
  });

  it("should not match different IP", () => {
    expect(isBypassedHost("10.0.0.6", ["10.0.0.5"])).toBe(false);
  });

  it("should match CIDR notation", () => {
    expect(isBypassedHost("192.168.1.50", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("192.168.2.50", ["192.168.1.0/24"])).toBe(false);
  });

  it("should match wildcard subnet", () => {
    expect(isBypassedHost("10.0.0.99", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("10.0.1.99", ["10.0.0.*"])).toBe(false);
  });

  it("should match multiple entries", () => {
    expect(isBypassedHost("10.0.0.5", ["192.168.1.1", "10.0.0.5"])).toBe(true);
  });
});

describe("escapeHtml", () => {
  it("should escape all HTML special characters", () => {
    expect(escapeHtml('&<>"\'')).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("should escape script tags to prevent XSS", () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("should escape crafted email addresses", () => {
    expect(escapeHtml('<img onerror="alert(1)" src=x>@evil.com')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;@evil.com',
    );
  });

  it("should pass through safe strings unchanged", () => {
    expect(escapeHtml("user@example.com")).toBe("user@example.com");
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

// G25 — `_reloadAuth` must apply the SAME trusted-network merge boot does.
// Boot merges top-level `trustedNetworks` into `auth.bypassHosts`
// (`resolvedTrustedNetworks`); the reload used to read `newConfig.bypassHosts`
// alone, so every auth-carrying `PUT /api/config` silently dropped top-level
// entries from the gate until restart. Pre-existing defect, fixed in D15.
// See change: config-override-oauth-redirect-base.
describe("G25: top-level trustedNetworks survive an auth reload", () => {
  async function bootedApp() {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const app = Fastify();
    const authConfig = {
      secret: "test-secret-32-chars-long-abcdef",
      providers: { github: { clientId: "cid", clientSecret: "csecret" } },
    };
    await registerAuthPlugin(app, {
      authConfig,
      port: 8000,
      // What boot passes: top-level trustedNetworks ∪ auth.bypassHosts.
      resolvedTrustedNetworks: ["10.0.0.0/8"],
    });
    app.get("/api/sessions", async () => ({ success: true }));
    await app.ready();
    return { app, authConfig };
  }

  it("keeps bypassing a top-level CIDR after a reload carrying the full config", async () => {
    const { app, authConfig } = await bootedApp();
    const bypassed = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "10.1.2.3",
    });
    expect(bypassed.statusCode).toBe(200);

    // A settings write that carries an `auth` block but no bypassHosts. The
    // full config still resolves the top-level network, so the gate must hold.
    await (app as any)._reloadAuth(authConfig, {
      trustedNetworks: ["10.0.0.0/8"],
      resolvedTrustedNetworks: ["10.0.0.0/8"],
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "10.1.2.3",
    });
    expect(after.statusCode).toBe(200);
    await app.close();
  });

  it("still refuses an address outside the trusted range", async () => {
    const { app, authConfig } = await bootedApp();
    await (app as any)._reloadAuth(authConfig, { resolvedTrustedNetworks: ["10.0.0.0/8"] });
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "203.0.113.7",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── fix-trusted-network-tunnel-bypass ─────────────────────────────────────
// A relayed-loopback peer (loopback socket + forwarding header) is a tunnel
// agent; a loopback bypassHosts / trustedNetworks entry must not admit it.

const RELAYED = { "x-forwarded-for": "203.0.113.9" };

describe("E8 OAuth bypass-host skip refuses relayed loopback", () => {
  async function app(bypass: string[]) {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: {
        secret: "test-secret-32-chars-long-abcdef",
        providers: { github: { clientId: "cid", clientSecret: "csecret" } },
      },
      port: 8000,
      resolvedTrustedNetworks: bypass,
    });
    a.get("/api/sessions", async (req) => ({ isAuthenticated: (req as any).isAuthenticated === true }));
    await a.ready();
    return a;
  }

  it("does not skip auth for a relayed-loopback peer with bypassHosts [127.0.0.1]", async () => {
    const a = await app(["127.0.0.1"]);
    const res = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "127.0.0.1", headers: RELAYED });
    await a.close();
    expect(res.statusCode).toBe(401);
  });

  it("still skips auth for a LAN peer inside a bypass CIDR (control)", async () => {
    const a = await app(["192.168.16.0/24"]);
    const res = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "192.168.16.20" });
    await a.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isAuthenticated: false });
  });

  it("still admits a header-less loopback request (genuine local)", async () => {
    const a = await app(["127.0.0.1"]);
    const res = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "127.0.0.1" });
    await a.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("E9 validateWsUpgrade refuses relayed loopback", () => {
  it("(a) relayed loopback, no credential -> false", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET, ["127.0.0.1"], { headers: RELAYED })).toBe(false);
  });
  it("(b) LAN peer in trusted CIDR -> true", () => {
    expect(validateWsUpgrade(undefined, "192.168.16.20", SECRET, ["192.168.16.0/24"], { headers: {} })).toBe(true);
  });
  it("(c) relayed loopback with a valid browser ticket -> true", async () => {
    const { WsTicketStore } = await import("../auth/ws-ticket.js");
    const store = new WsTicketStore();
    const ticket = store.mint("browser");
    expect(
      validateWsUpgrade(undefined, "127.0.0.1", SECRET, ["127.0.0.1"], {
        headers: RELAYED,
        ticket,
        scope: "browser",
        consumeTicket: (t, s) => store.consume(t, s),
      }),
    ).toBe(true);
  });
});

// ── surface-operate-required-remedy ───────────────────────────────────────
// The `sign-in` remedy asks "is a usable login method configured right now?".
describe("E3 buildLoginAvailable composition", () => {
  const identity = (enforced: boolean, n: number): { enforced: () => boolean; loginConfigs: () => readonly unknown[] } => ({ enforced: () => enforced, loginConfigs: () => new Array(n).fill({}) });
  const none = identity(false, 0);
  const on = { isEnabled: () => true };
  const off = { isEnabled: () => false };

  type Oauth = (() => boolean) | null;
  type Passkeys = { isEnabled(): boolean } | undefined;
  type Ident = { enforced: () => boolean; loginConfigs: () => readonly unknown[] };
  const cases: Array<[string, Oauth, Passkeys, Ident, boolean]> = [
    ["oauth alone", () => true, off, none, true],
    ["passkeys alone", () => false, on, none, true],
    ["identity enforced with a login config alone", () => false, off, identity(true, 1), true],
    ["empty-clientId provider only (accessor false)", () => false, off, none, false],
    ["identity not enforced, config registered", () => false, off, identity(false, 2), false],
    ["identity enforced, no config", () => false, off, identity(true, 0), false],
    ["all absent", () => false, off, none, false],
    ["null oauth accessor, no passkeys", null, undefined, none, false],
    ["null oauth accessor, passkeys on", null, on, none, true],
  ];
  it.each(cases)("%s → %s", async (_l, oauth, passkeys, ident, expected) => {
    const { buildLoginAvailable } = await import("../auth/auth-plugin.js");
    const fn = buildLoginAvailable(oauth, passkeys, ident);
    expect(typeof fn).toBe("function");
    expect(fn()).toBe(expected);
  });

  it("reads every source at call time", async () => {
    const { buildLoginAvailable } = await import("../auth/auth-plugin.js");
    let oauth = false;
    const fn = buildLoginAvailable(() => oauth, null, { enforced: () => false, loginConfigs: () => [] });
    expect(fn()).toBe(false);
    oauth = true;
    expect(fn()).toBe(true);
  });

  it("the plugin accessor ignores an empty-clientId provider and sees a reload", async () => {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const app = Fastify();
    const base = { secret: "test-secret-32-chars-long-abcdef" };
    const handle = await registerAuthPlugin(app, {
      authConfig: { ...base, providers: { github: { clientId: "", clientSecret: "s" } } },
      port: 8000,
    });
    expect(handle.hasUsableOAuthProvider()).toBe(false);
    await (app as any)._reloadAuth({ ...base, providers: { github: { clientId: "cid", clientSecret: "s" } } });
    expect(handle.hasUsableOAuthProvider()).toBe(true);
    await app.close();
  });
});

describe("E4 a boot-inert auth plugin stays false", () => {
  it("no providers + passkeys off: accessor is a function, reads false, and a config write does not change it", async () => {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const app = Fastify();
    const base = { secret: "test-secret-32-chars-long-abcdef" };
    const handle = await registerAuthPlugin(app, { authConfig: { ...base, providers: {} }, port: 8000 });
    expect(typeof handle.hasUsableOAuthProvider).toBe("function");
    expect(handle.hasUsableOAuthProvider()).toBe(false);
    // The early-return path installs no reload hook: the config write is a no-op here.
    expect((app as any)._reloadAuth).toBeUndefined();
    expect(handle.hasUsableOAuthProvider()).toBe(false);
    await app.close();
  });
});

// ── retire-trusted-networks-bypass: OAuth skip reads the LIVE admission list ──
// E9 (OAuth leg) + E11 (credential-first ordering). The hook consults
// `readAdmissionTrustedNetworks()` per request; the mode lives in a real
// temp-HOME config.json.
describe("OAuth hook — bypass hosts are the live, mode-dependent admission list", () => {
  const AUTH_SECRET = "test-secret-32-chars-long-abcdef";
  const LISTED = "192.168.16.20";
  let th: TrustModeHome;
  beforeEach(() => {
    th = useTrustModeHome();
  });
  afterEach(() => {
    th.restore();
  });

  async function app(opts: { live?: boolean; boot?: string[] } = {}) {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: { secret: AUTH_SECRET, providers: { github: { clientId: "cid", clientSecret: "csecret" } } },
      port: 8000,
      ...(opts.live === false ? {} : { readAdmissionTrustedNetworks: () => admissionTrustedNetworks() }),
      ...(opts.boot ? { resolvedTrustedNetworks: opts.boot } : {}),
    });
    a.get("/api/sessions", async (req) => ({
      isAuthenticated: (req as any).isAuthenticated === true,
      authVia: (req as any).authVia ?? null,
    }));
    await a.ready();
    return a;
  }

  const sessionCookie = (): string =>
    signToken({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, AUTH_SECRET);

  // test-plan #E9 (OAuth leg)
  it("E9: bypass host + listed peer, no cookie: legacy → skipped; pair → 401 JSON / redirect for html", async () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: ["10.0.0.0/8"] });
    const a = await app();
    const legacy = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.0.0.5" });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toEqual({ isAuthenticated: false, authVia: null });

    th.setTrustConfig({ trustMode: "pair", trustedNetworks: ["10.0.0.0/8"] });
    const json = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.0.0.5" });
    expect(json.statusCode).toBe(401);
    const html = await a.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "10.0.0.5",
      headers: { accept: "text/html" },
    });
    expect(html.statusCode).toBe(302);
    expect(String(html.headers.location)).toContain("/auth/login");
    await a.close();
  });

  // test-plan #E10 (OAuth leg): same plugin instance, no restart
  it("E10: a mode change applies on the next request to the same plugin instance", async () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: ["10.0.0.0/8"] });
    const a = await app();
    const get = async () => (await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.0.0.5" })).statusCode;
    expect(await get()).toBe(401);
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: ["10.0.0.0/8"] });
    expect(await get()).toBe(200);
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: ["10.0.0.0/8"] });
    expect(await get()).toBe(401);
    await a.close();
  });

  it("without the live reader the boot list is the fallback (embedder / legacy callers)", async () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: [] });
    const a = await app({ live: false, boot: ["10.0.0.0/8"] });
    const res = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.0.0.5" });
    await a.close();
    expect(res.statusCode).toBe(200);
  });

  // test-plan #E11
  it("E11: valid session cookie from a bypass host → authVia 'session' and authenticated (not network-only)", async () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: ["192.168.16.0/24"] });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: LISTED,
      cookies: { [COOKIE_NAME]: sessionCookie() },
    });
    await a.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isAuthenticated: true, authVia: "session" });
    expect(networkOnlySnapshot().admissions).toBe(0);
  });

  it("E11: valid session cookie from a listed peer is authenticated in pair mode too", async () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: ["192.168.16.0/24"] });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: LISTED,
      cookies: { [COOKIE_NAME]: sessionCookie() },
    });
    await a.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().authVia).toBe("session");
  });

  it.each([
    ["garbage", () => "not-a-jwt"],
    ["expired", () => jwt.sign({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, AUTH_SECRET, { expiresIn: -60 })],
    ["wrong-secret", () => signToken({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, "another-secret-32-chars-long-abcd")],
  ])("E11: %s session cookie from a bypass host → skipped, NO cookie-clearing Set-Cookie", async (_l, mk) => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: ["192.168.16.0/24"] });
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: LISTED,
      cookies: { [COOKIE_NAME]: mk() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ isAuthenticated: false, authVia: null });
    expect(res.headers["set-cookie"], "no cookie-clearing on a bypass host").toBeUndefined();

    // Control: the same rejected cookie from a NON-bypass host is refused AND cleared (today's behaviour).
    const off = await a.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "203.0.113.9",
      cookies: { [COOKIE_NAME]: mk() },
    });
    await a.close();
    expect(off.statusCode).toBe(401);
    expect(String(off.headers["set-cookie"])).toContain(`${COOKIE_NAME}=;`);
  });
});

// ── add-plugin-capability-routes: the OAuth hook skips `serveApp` mounts (test-plan #E15) ──
describe("OAuth hook — serveApp mounts load without sign-in", () => {
  const AUTH_SECRET = "test-secret-32-chars-long-abcdef";
  let th: TrustModeHome;
  let tmpRoot: string;
  beforeEach(() => {
    th = useTrustModeHome();
    tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "auth-apps-")));
    fs.mkdirSync(path.join(tmpRoot, "dist", "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "dist", "index.html"), "<p>shell</p>");
    fs.writeFileSync(path.join(tmpRoot, "dist", "assets", "a.js"), "1");
    clearAppMountRegistry();
  });
  afterEach(() => {
    th.restore();
    clearAppMountRegistry();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function app() {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: { secret: AUTH_SECRET, providers: { github: { clientId: "cid", clientSecret: "csecret" } } },
      port: 8000,
    });
    mountApp(
      { fastify: a, pluginId: "wall", packageRoot: tmpRoot, dataDir: path.join(tmpRoot, "data"), logger: { info() {}, warn() {}, error() {} } },
      { dir: path.join(tmpRoot, "dist"), csp: "default-src 'none'" },
    );
    a.get("/apps/rogue/", async () => "rogue");
    a.get("/api/sessions", async () => ({ ok: true }));
    await a.ready();
    return a;
  }

  it("E15: unauthenticated remote GET of the mount and its assets → 200, no 302/401", async () => {
    const a = await app();
    const shell = await a.inject({ method: "GET", url: "/apps/wall/", remoteAddress: "203.0.113.5", headers: { accept: "text/html" } });
    const asset = await a.inject({ method: "GET", url: "/apps/wall/assets/a.js", remoteAddress: "203.0.113.5" });
    const bare = await a.inject({ method: "GET", url: "/apps/wall", remoteAddress: "203.0.113.5", headers: { accept: "text/html" } });
    await a.close();
    expect(shell.statusCode).toBe(200);
    expect(asset.statusCode).toBe(200);
    expect(bare.statusCode).toBe(308);
  });

  it("E15 control: an unmounted /apps/* path and /api/* still require sign-in", async () => {
    const a = await app();
    const rogue = await a.inject({ method: "GET", url: "/apps/rogue/", remoteAddress: "203.0.113.5", headers: { accept: "text/html" } });
    const api = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: "203.0.113.5" });
    const lookalike = await a.inject({ method: "GET", url: "/apps/wall2/", remoteAddress: "203.0.113.5", headers: { accept: "text/html" } });
    await a.close();
    expect(rogue.statusCode).toBe(302);
    expect(String(rogue.headers.location)).toContain("/auth/login");
    expect(api.statusCode).toBe(401);
    expect(lookalike.statusCode).toBe(302);
  });
});

describe("OAuth hook — the CSP report sink is public, narrowly (WE34)", () => {
  const AUTH_SECRET = "test-secret-32-chars-long-abcdef";
  let th: TrustModeHome;
  let tmp: string;
  beforeEach(() => {
    th = useTrustModeHome();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-csp-sink-"));
  });
  afterEach(() => {
    th.restore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function app() {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const { registerCspReportSink } = await import("../auth/csp-report-sink.js");
    const { CspReportStore } = await import("../auth/csp-report-store.js");
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: { secret: AUTH_SECRET, providers: { github: { clientId: "cid", clientSecret: "csecret" } } },
      port: 8000,
    });
    registerCspReportSink(a, {
      store: new CspReportStore({ filePath: path.join(tmp, "csp-reports.json") }),
      networkGuard: async () => {},
      log: () => {},
    });
    a.post("/__pi/other", async () => ({ reached: true }));
    a.get("/api/config", async () => ({ reached: true }));
    await a.ready();
    return a;
  }

  const REMOTE = "203.0.113.5";
  const body = JSON.stringify({ "csp-report": { "effective-directive": "script-src-elem" } });
  const gateOf = (r: { statusCode: number; headers: Record<string, unknown> }) => `${r.statusCode} ${String(r.headers.location ?? "")}`;

  it("POST on exactly the three policy paths (query ignored) is neither redirected nor refused", async () => {
    const a = await app();
    for (const url of ["/__pi/csp-report/baseline", "/__pi/csp-report/strict", "/__pi/csp-report/trusted-types", "/__pi/csp-report/strict?x=1"]) {
      const res = await a.inject({ method: "POST", url, remoteAddress: REMOTE, headers: { "content-type": "application/csp-report" }, payload: body });
      expect(res.statusCode, url).toBe(204);
    }
    await a.close();
  });

  it("every other shape gets the same gate response as an unrelated /__pi/ path (no prefix match)", async () => {
    const a = await app();
    const control = await a.inject({ method: "POST", url: "/__pi/other", remoteAddress: REMOTE, headers: { "content-type": "application/csp-report" }, payload: body });
    expect([302, 401]).toContain(control.statusCode);
    const rows: Array<[string, string]> = [
      ["GET", "/__pi/csp-report/strict"],
      ["PUT", "/__pi/csp-report/strict"],
      ["OPTIONS", "/__pi/csp-report/strict"],
      ["POST", "/__pi/csp-report/strict-evil"],
      ["POST", "/__pi/csp-report/strict/extra"],
      ["POST", "/__pi/csp-report/"],
      ["POST", "/__pi/csp-report"],
      ["POST", "/__PI/csp-report/strict"],
      ["POST", "//__pi/csp-report/strict"],
      ["POST", "/__pi/csp-report/../../api/config"],
    ];
    for (const [method, url] of rows) {
      const res = await a.inject({ method: method as "GET", url, remoteAddress: REMOTE, headers: { "content-type": "application/csp-report" }, payload: method === "POST" || method === "PUT" ? body : undefined });
      expect(gateOf(res as never), `${method} ${url}`).toBe(gateOf(control as never));
    }
    const api = await a.inject({ method: "GET", url: "/api/config", remoteAddress: REMOTE });
    expect(api.statusCode).toBe(401);
    await a.close();
  });
});

// ── harden-auth-credentials (B17): the session cookie accepts HS256 only ──
describe("OAuth hook — non-HS256 session JWTs are rejected (AE2, AE3)", () => {
  const AUTH_SECRET = "test-secret-32-chars-long-abcdef";
  const EXTERNAL = "203.0.113.9";
  const claims = { sub: "u@example.com", name: "U", username: "u", provider: "github" };

  async function app() {
    const { default: Fastify } = await import("fastify");
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    const a = Fastify();
    await registerAuthPlugin(a, {
      authConfig: { secret: AUTH_SECRET, providers: { github: { clientId: "cid", clientSecret: "csecret" } } },
      port: 8000,
    });
    const reached = { n: 0 };
    a.get("/api/sessions", async () => {
      reached.n++;
      return { ok: true };
    });
    a.get("/", async () => {
      reached.n++;
      return { ok: true };
    });
    await a.ready();
    return { a, reached };
  }
  const cleared = (res: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).some((c) =>
      new RegExp(`^${COOKIE_NAME}=;`).test(c) && /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );

  it("AE2 a correctly signed HS384 cookie → 401, cookie cleared, handler not reached", async () => {
    const { a, reached } = await app();
    const token = jwt.sign(claims, AUTH_SECRET, { algorithm: "HS384", expiresIn: "1h" });
    const res = await a.inject({ method: "GET", url: "/api/sessions", remoteAddress: EXTERNAL, cookies: { [COOKIE_NAME]: token } });
    await a.close();
    expect(res.statusCode).toBe(401);
    expect(cleared(res)).toBe(true);
    expect(reached.n).toBe(0);
    // Control: the same claims signed HS256 are admitted.
    const ok = await (async () => {
      const { a: b } = await app();
      const r = await b.inject({ method: "GET", url: "/api/sessions", remoteAddress: EXTERNAL, cookies: { [COOKIE_NAME]: signToken(claims, AUTH_SECRET) } });
      await b.close();
      return r;
    })();
    expect(ok.statusCode).toBe(200);
  });

  // The pin classifies a non-HS256 token as INVALID (401, like a tampered one), not as expired.
  // NOTE (spec gap, reported): the hook picks redirect-vs-401 from the `Accept` header, not from
  // the rejection reason, so "(a) 302 / (b) 401" is exercised here with the Accept a browser
  // navigation (a) / an API client (b) sends; see the ship-it report.
  it("AE3 expired HS256 → 302 /auth/login + cleared; HS384 → 401 + cleared", async () => {
    const { a, reached } = await app();
    const expired = jwt.sign(claims, AUTH_SECRET, { algorithm: "HS256", expiresIn: -1 });
    const hs384 = jwt.sign(claims, AUTH_SECRET, { algorithm: "HS384", expiresIn: "1h" });
    const html = { accept: "text/html" };
    const resA = await a.inject({ method: "GET", url: "/", remoteAddress: EXTERNAL, headers: html, cookies: { [COOKIE_NAME]: expired } });
    const resB = await a.inject({ method: "GET", url: "/", remoteAddress: EXTERNAL, cookies: { [COOKIE_NAME]: hs384 } });
    await a.close();
    expect(resA.statusCode).toBe(302);
    expect(String(resA.headers.location)).toMatch(/^\/auth\/login/);
    expect(cleared(resA)).toBe(true);
    expect(resB.statusCode).toBe(401);
    expect(cleared(resB)).toBe(true);
    expect(reached.n).toBe(0);
  });
});
