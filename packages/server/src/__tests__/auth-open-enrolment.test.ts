/**
 * OAuth fail-closed for public IdPs (HTTP-01): open-enrolment refusal at login, already-issued
 * session rejection, reload warnings, live diagnostics posture.
 *
 * Plugin-level tests for change `close-security-map-high-findings` (D3). Test-plan rows are
 * cited as `#E<n>` / `#X<n>` / `#P<n>` in the test names. Socket sweep tests live in
 * `pairing/__tests__/ws-tier-gate.test.ts`; the pure classifier table in `auth.test.ts`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const userInfo = vi.fn(async () => ({ email: "u@example.com", name: "U", username: "u" }) as Record<string, unknown>);
const tokens = vi.fn(async (): Promise<{ accessToken: string; idToken?: string }> => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (tokens as any)(...a),
  fetchUserInfo: (...a: unknown[]) => (userInfo as any)(...a),
}));

import { CONFIG_FILE, loadConfig, type AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import {
  type AuthPluginHandle,
  authorizeWsUpgrade,
  effectiveSessionTier,
  registerAuthPlugin,
} from "../auth/auth-plugin.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const REMOTE = "203.0.113.5";
const PORT = 8000;
const gh = { clientId: "cid", clientSecret: "SECRET-gh" };
const KC_ISSUER = "https://sso.example.com/realms/acme";
const kc = { clientId: "kid", clientSecret: "SECRET-kc", issuerUrl: KC_ISSUER };
const DISCOVERY = {
  authorization_endpoint: "https://sso.example.com/auth",
  token_endpoint: "https://sso.example.com/token",
  userinfo_endpoint: "https://sso.example.com/userinfo",
};

// ─── fixtures ───────────────────────────────────────────────────────────────

/** Hosts whose OIDC discovery fails; every other discovery succeeds. */
const failingHosts = new Set<string>();
const fetchMock = vi.fn(async (url: string | URL) => {
  const u = String(url);
  if ([...failingHosts].some((h) => u.includes(h))) throw new Error("discovery down");
  return { ok: true, status: 200, json: async () => DISCOVERY } as unknown as Response;
});

let apps: FastifyInstance[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  failingHosts.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  userInfo.mockReset();
  userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u" });
  tokens.mockReset();
  tokens.mockResolvedValue({ accessToken: "access-token" });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

interface Built {
  app: FastifyInstance;
  handle: AuthPluginHandle;
  config: AuthConfig;
}

async function build(
  config: Partial<AuthConfig> & { providers: AuthConfig["providers"] },
  opts: { onAuthReloaded?: () => void } = {},
): Promise<Built> {
  const app = Fastify();
  const authConfig = { secret: SECRET, ...config } as AuthConfig;
  const handle = await registerAuthPlugin(app, { authConfig, port: PORT, ...opts });
  app.get("/api/ping", async () => ({ ok: true }));
  await app.ready();
  apps.push(app);
  return { app, handle, config: authConfig };
}

const reload = (b: Built, next: Partial<AuthConfig> & { providers: AuthConfig["providers"] }) =>
  (b.app as any)._reloadAuth({ secret: SECRET, ...next } as AuthConfig) as Promise<void>;

/** A state cookie the plugin accepts (same derivation as `stateKey`/`stateMac`). */
function forgeState(returnUrl = "/") {
  const nonce = crypto.randomBytes(8).toString("hex");
  const key = crypto.createHmac("sha256", SECRET).update("pi-dashboard/oauth-state/v1").digest();
  const mac = crypto.createHmac("sha256", key).update(nonce).digest("hex");
  const state = Buffer.from(JSON.stringify({ returnUrl, nonce })).toString("base64url");
  return { state, cookie: `pi_dash_oauth_state=${nonce}.${mac}` };
}

const callback = (a: FastifyInstance, key: string, extra = "") => {
  const { state, cookie } = forgeState();
  return a.inject({
    method: "GET",
    url: `/auth/callback/${key}?code=C&state=${state}${extra}`,
    headers: { cookie },
  });
};
const start = (a: FastifyInstance, key: string) => a.inject({ method: "GET", url: `/auth/start/${key}` });
const login = (a: FastifyInstance, headers: Record<string, string> = {}) =>
  a.inject({ method: "GET", url: "/auth/login", headers });

const setCookies = (res: { headers: Record<string, any> }) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const sessionCookieSet = (res: { headers: Record<string, any> }) =>
  setCookies(res).some((c) => c.startsWith("pi_dash_token=") && !/pi_dash_token=;/.test(c));
const sessionCookieCleared = (res: { headers: Record<string, any> }) =>
  setCookies(res).some((c) => /^pi_dash_token=;/.test(c));

const jwtCookie = (provider: string, extra: Record<string, unknown> = {}) =>
  `${COOKIE_NAME}=${signToken({ sub: "a@x", name: "A", username: "a", provider, ...extra } as any, SECRET)}`;
const ping = (a: FastifyInstance, cookie: string, accept?: string) =>
  a.inject({
    method: "GET",
    url: "/api/ping",
    remoteAddress: REMOTE,
    headers: { cookie, ...(accept ? { accept } : {}) },
  });

const isRemedyPage = (body: string) => body.includes("auth.allowedUsers") && body.includes("auth.groupTiers");
const warnLines = () => warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
const enrolmentWarningsFor = (key: string) =>
  warnLines().filter((l: string) => l.includes(JSON.stringify(key)) && l.includes("open enrolment"));
const auditLines = () => logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[oauth] login_refused"));

// ─── #E74–#E82 open-enrolment decision table ───────────────────────────────

describe("open-enrolment decision table (provider class × allowedUsers × groupTiers)", () => {
  const refusedRows: Array<[string, string, Partial<AuthConfig>]> = [
    ["#E74 public + allowedUsers []", "github", { allowedUsers: [] }],
    ["#E75 public + allowedUsers unset", "github", {}],
    ["#E79 public + empty groupTiers {}", "github", { allowedUsers: [], groupTiers: {} }],
  ];
  it.each(refusedRows)("%s → refused at start, callback and login", async (_n, key, extra) => {
    const { app } = await build({ providers: { [key]: gh }, ...extra });
    const s = await start(app, key);
    expect(s.statusCode).toBe(403);
    expect(s.headers.location).toBeUndefined();
    expect(isRemedyPage(s.body)).toBe(true);
    const c = await callback(app, key);
    expect(c.statusCode).toBe(403);
    expect(isRemedyPage(c.body)).toBe(true);
    expect(sessionCookieSet(c)).toBe(false);
    const l = await login(app);
    expect(l.statusCode).toBe(403);
    expect(l.headers.location).toBeUndefined();
    expect(tokens).not.toHaveBeenCalled();
    expect(userInfo).not.toHaveBeenCalled();
  });

  it("#E76 blank-entry allowlist [''] is NOT open enrolment: flow proceeds, every account is denied", async () => {
    const { app } = await build({ providers: { github: gh }, allowedUsers: [""] });
    expect((await start(app, "github")).statusCode).toBe(302);
    expect((await login(app)).statusCode).toBe(302);
    const c = await callback(app, "github");
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access Denied");
  });

  it("#E77 public + allowedUsers [octocat]: octocat admitted at operate; another account denied", async () => {
    const { app } = await build({ providers: { github: gh }, allowedUsers: ["octocat"] });
    expect((await start(app, "github")).statusCode).toBe(302);
    userInfo.mockResolvedValue({ email: "o@example.com", name: "O", username: "octocat" });
    const ok = await callback(app, "github");
    expect(ok.statusCode).toBe(302);
    expect(sessionCookieSet(ok)).toBe(true);
    userInfo.mockResolvedValue({ email: "x@example.com", name: "X", username: "mallory" });
    const denied = await callback(app, "github");
    expect(denied.statusCode).toBe(403);
    expect(denied.body).toContain("Access Denied");
  });

  it("#E78 public + groupTiers only: refusal lifted; github has no groups claim → access denied for all (unchanged)", async () => {
    const { app } = await build({ providers: { github: gh }, allowedUsers: [], groupTiers: { ops: "operate" } });
    expect((await start(app, "github")).statusCode).toBe(302);
    expect((await login(app)).statusCode).toBe(302);
    const c = await callback(app, "github");
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access Denied");
    expect(isRemedyPage(c.body)).toBe(false);
  });

  it("#E80 public + allowedUsers [*@gmail.com]: any gmail account admitted (deliberate wildcard)", async () => {
    const { app } = await build({ providers: { github: gh }, allowedUsers: ["*@gmail.com"] });
    userInfo.mockResolvedValue({ email: "anyone@gmail.com", name: "A", username: "anyone" });
    const c = await callback(app, "github");
    expect(c.statusCode).toBe(302);
    expect(sessionCookieSet(c)).toBe(true);
  });

  it("#E81 non-public + empty lists: allow-all at operate, ONE warning at register, diagnostics mode open", async () => {
    const { app } = await build({ providers: { keycloak: kc } });
    expect((await start(app, "keycloak")).statusCode).toBe(302);
    const c = await callback(app, "keycloak");
    expect(c.statusCode).toBe(302);
    expect(enrolmentWarningsFor("keycloak")).toHaveLength(1);
    expect((app as any)._authOpenEnrolment()).toEqual([{ provider: "keycloak", mode: "open" }]);
  });

  it("#E82 non-public + groupTiers: group rules decide; no warning", async () => {
    const { app } = await build({ providers: { keycloak: kc }, groupTiers: { ops: "operate" } });
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u", groups: ["nope"] });
    const c = await callback(app, "keycloak");
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access Denied");
    expect(enrolmentWarningsFor("keycloak")).toHaveLength(0);
  });

  it("#E83 non-public + allowedUsers [a@b.c]: allowlist decides; no warning", async () => {
    const { app } = await build({ providers: { keycloak: kc }, allowedUsers: ["a@b.c"] });
    const c = await callback(app, "keycloak"); // u@example.com is not on the list
    expect(c.statusCode).toBe(403);
    expect(c.body).toContain("Access Denied");
    expect(enrolmentWarningsFor("keycloak")).toHaveLength(0);
  });
});

// ─── #E72 / #E84 / #E85 / #X16 public issuer under an arbitrary key ──────────

describe("public issuer under an arbitrary key", () => {
  it("#E73 failed discovery does not change the classification", async () => {
    failingHosts.add("accounts.google.com");
    const b = await build({
      providers: { oidc: { ...gh, issuerUrl: "https://accounts.google.com" }, keycloak: kc },
    });
    const fetchesAtBoot = fetchMock.mock.calls.length;
    // registry lacks oidc (discovery failed) …
    expect(b.handle.hasUsableOAuthProvider()).toBe(true); // keycloak only
    // … but it is classified public + open: refused, no fetch, JWT rejected, listed, one warning
    const s = await start(b.app, "oidc");
    expect(s.statusCode).toBe(403);
    expect(isRemedyPage(s.body)).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(fetchesAtBoot);
    expect(b.handle.isSessionProviderRejected("oidc")).toBe(true);
    expect((await ping(b.app, jwtCookie("oidc"))).statusCode).toBe(401);
    expect((b.app as any)._authOpenEnrolment()).toEqual([
      { provider: "oidc", mode: "refused" },
      { provider: "keycloak", mode: "open" },
    ]);
    expect(enrolmentWarningsFor("oidc")).toHaveLength(1);
  });

  it("#E84 oidc + accounts.google.com issuer is refused at start and callback; token endpoint never contacted", async () => {
    const b = await build({
      providers: { oidc: { ...gh, issuerUrl: "https://accounts.google.com" } },
    });
    const calls = fetchMock.mock.calls.length;
    const s = await start(b.app, "oidc");
    expect(s.statusCode).toBe(403);
    const c = await callback(b.app, "oidc");
    expect(c.statusCode).toBe(403);
    expect(isRemedyPage(c.body)).toBe(true);
    expect(sessionCookieSet(c)).toBe(false);
    expect(tokens).not.toHaveBeenCalled();
    expect(userInfo).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("#E85 Microsoft /common is refused; a specific tenant stays open with a warning and mode open", async () => {
    const common = await build({
      providers: { oidc: { ...gh, issuerUrl: "https://login.microsoftonline.com/common/v2.0" } },
    });
    expect((await start(common.app, "oidc")).statusCode).toBe(403);
    expect((common.app as any)._authOpenEnrolment()).toEqual([{ provider: "oidc", mode: "refused" }]);

    const tenant = await build({
      providers: {
        oidc: { ...gh, issuerUrl: "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0" },
      },
    });
    expect((await start(tenant.app, "oidc")).statusCode).toBe(302);
    expect((tenant.app as any)._authOpenEnrolment()).toEqual([{ provider: "oidc", mode: "open" }]);
    expect(enrolmentWarningsFor("oidc").length).toBeGreaterThanOrEqual(1);
  });

  it("#X16 refusal at /auth/start does not wait for the IdP (discovery hangs → no await, no fetch)", async () => {
    const b = await build({ providers: { oidc: { ...gh, issuerUrl: "https://accounts.google.com" } } });
    // Discovery now hangs forever; /auth/start must not touch it.
    const hang = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", hang);
    const s = await start(b.app, "oidc");
    expect(s.statusCode).toBe(403);
    expect(isRemedyPage(s.body)).toBe(true);
    expect(hang).not.toHaveBeenCalled();
  });
});

// ─── #E86 / #E87 picker and remedy page ──────────────────────────────────────

describe("login picker and remedy page", () => {
  it("#E86 (a) single refused provider never auto-redirects: 403 remedy page, no Location", async () => {
    const { app } = await build({ providers: { github: gh } });
    const res = await login(app);
    expect(res.statusCode).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(isRemedyPage(res.body)).toBe(true);
  });

  it("#E86 (b) refused + ok provider: picker 200; refused item has no sign-in link but a text note; ok keeps its link", async () => {
    // `groupTiers`/`allowedUsers` are global, so "refused + ok" needs one public + one non-public provider
    // with both lists empty: the non-public one stays open (allow-all) and keeps its link.
    const { app } = await build({ providers: { github: gh, keycloak: kc } });
    const res = await login(app);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("/auth/start/github");
    expect(res.body).toContain("/auth/start/keycloak");
    expect(res.body).toContain("not configured for sign-in");
    expect(res.body).toContain("auth.allowedUsers");
    expect(res.body).toContain("auth.groupTiers");
  });

  it("#E86 (c) refused provider + passkeys enabled: picker (no auto-redirect/403)", async () => {
    const passkeys = {
      configure: () => {},
      isEnabled: () => true,
      rpContext: () => ({ rpId: "localhost", origin: "http://localhost:8000" }),
      sessionTier: () => null,
    } as any;
    const app = Fastify();
    await registerAuthPlugin(app, { authConfig: { secret: SECRET, providers: { github: gh } } as AuthConfig, port: PORT, passkeys });
    await app.ready();
    apps.push(app);
    const res = await login(app);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("/auth/start/github");
    expect(res.body).toContain("not configured for sign-in");
  });

  it("#E87 remedy page names both fields, echoes no identity/query, escapes the provider key, is 403 html", async () => {
    const hostile = 'a&b"<x>';
    const { app } = await build({
      providers: { [hostile]: { ...gh, issuerUrl: "https://accounts.google.com" } },
    });
    const res = await app.inject({
      method: "GET",
      url: `/auth/callback/${encodeURIComponent(hostile)}?code=SECRET123&email=%3Cscript%3E&username=u&state=${forgeState().state}`,
      headers: { cookie: forgeState().cookie },
    });
    // A mismatching state redirects first (#E88); use the matching pair for the page itself:
    const { state, cookie } = forgeState();
    const page = await app.inject({
      method: "GET",
      url: `/auth/callback/${encodeURIComponent(hostile)}?code=SECRET123&email=%3Cscript%3E&username=u&state=${state}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(302); // state mismatch precedes the refusal
    expect(page.statusCode).toBe(403);
    expect(page.headers["content-type"]).toMatch(/text\/html/);
    expect(isRemedyPage(page.body)).toBe(true);
    for (const leak of ["SECRET123", "<script>", "username", "email=", "u@example.com"]) {
      expect(page.body).not.toContain(leak);
    }
    expect(page.body).not.toContain(hostile);
    expect(page.body).toContain("a&amp;b&quot;&lt;x&gt;");
  });
});

// ─── #E88 callback ordering ─────────────────────────────────────────────────

describe("callback ordering", () => {
  it("#E88 the state check precedes the refusal; a matching state gets the remedy page; cookie cleared both ways", async () => {
    const { app } = await build({ providers: { github: gh } });
    const bad = await app.inject({ method: "GET", url: "/auth/callback/github?code=C&state=bad" });
    expect(bad.statusCode).toBe(302);
    expect(bad.headers.location).toContain("/auth/login?error=");
    expect(setCookies(bad).some((c) => c.startsWith("pi_dash_oauth_state=;"))).toBe(true);
    const good = await callback(app, "github");
    expect(good.statusCode).toBe(403);
    expect(setCookies(good).some((c) => c.startsWith("pi_dash_oauth_state=;"))).toBe(true);
    expect(tokens).not.toHaveBeenCalled();
  });
});

// ─── #E89 live reload / #E105 callback robustness ────────────────────────────

describe("live allowlist edits", () => {
  it("#E89 adding / removing an allowlist or groupTiers applies on reload without a restart", async () => {
    const b = await build({ providers: { github: gh } });
    expect((await start(b.app, "github")).statusCode).toBe(403);

    await reload(b, { providers: { github: gh }, allowedUsers: ["octocat"] });
    expect((await start(b.app, "github")).statusCode).toBe(302);
    userInfo.mockResolvedValue({ email: "o@example.com", name: "O", username: "octocat" });
    expect((await callback(b.app, "github")).statusCode).toBe(302);
    userInfo.mockResolvedValue({ email: "m@example.com", name: "M", username: "mallory" });
    expect((await callback(b.app, "github")).statusCode).toBe(403);

    await reload(b, { providers: { github: gh }, allowedUsers: [] });
    expect((await start(b.app, "github")).statusCode).toBe(403);

    await reload(b, { providers: { github: gh }, allowedUsers: [], groupTiers: { ops: "operate" } });
    expect((await start(b.app, "github")).statusCode).toBe(302);
  });

  it("#E105 a throwing onAuthReloaded: the reload resolves, the new state stays applied, error logged", async () => {
    const b = await build(
      { providers: { github: gh } },
      {
        onAuthReloaded: () => {
          throw new Error("sweep boom");
        },
      },
    );
    await expect(reload(b, { providers: { github: gh }, allowedUsers: ["octocat"] })).resolves.toBeUndefined();
    expect((await start(b.app, "github")).statusCode).toBe(302); // no rollback
    expect(errSpy).toHaveBeenCalled();
    expect(String(errSpy.mock.calls[0]?.[0])).toContain("onAuthReloaded failed");
  });

  it("onAuthReloaded runs once per reload, after the new state is applied", async () => {
    let seen: number | null = null;
    let b!: Built;
    b = await build(
      { providers: { github: gh } },
      {
        onAuthReloaded: () => {
          seen = b.handle.isSessionProviderRejected("github") ? 1 : 0;
        },
      },
    );
    await reload(b, { providers: { github: gh }, allowedUsers: ["octocat"] });
    expect(seen).toBe(0); // the callback already sees the lifted state
  });
});

// ─── #E92 audit / #E93 warnings / #E94 diagnostics / #E95 tier ───────────────

describe("observability", () => {
  it("#E92 each refused request is audited once with provider + socket-peer ip only", async () => {
    const { app } = await build({ providers: { github: gh } });
    const spoof = { "x-forwarded-for": "9.9.9.9", forwarded: "for=9.9.9.9" };
    await app.inject({ method: "GET", url: "/auth/login", headers: spoof });
    await app.inject({ method: "GET", url: "/auth/start/github", headers: spoof });
    const { state, cookie } = forgeState();
    await app.inject({
      method: "GET",
      url: `/auth/callback/github?code=SECRET123&state=${state}&email=e@x.io&username=uname`,
      headers: { ...spoof, cookie },
    });
    const lines = auditLines();
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).toContain("provider=github");
      expect(l).toContain("reason=open_enrolment");
      expect(l).toContain("ip=127.0.0.1");
      for (const leak of ["9.9.9.9", "SECRET123", "e_x.io", "uname", "token"]) expect(l).not.toContain(leak);
    }
  });

  it("#E93 one warning per open-enrolment provider at register and at each reload; secrets never logged", async () => {
    failingHosts.add("idp.discovery-fail.example");
    const providers = {
      github: gh,
      keycloak: kc,
      oidc2: { ...gh, issuerUrl: "https://idp.discovery-fail.example" },
    };
    const b = await build({ providers });
    await reload(b, { providers });
    await reload(b, { providers });
    expect(enrolmentWarningsFor("github")).toHaveLength(3);
    expect(enrolmentWarningsFor("keycloak")).toHaveLength(3);
    expect(enrolmentWarningsFor("oidc2")).toHaveLength(3); // discovery-failed provider still warns
    for (const l of [...enrolmentWarningsFor("github"), ...enrolmentWarningsFor("keycloak")]) {
      expect(l).toContain("auth.allowedUsers");
      expect(l).toContain("auth.groupTiers");
    }
    const ghLine = enrolmentWarningsFor("github")[0];
    expect(ghLine).toContain("Settings ▸ Users");
    expect(ghLine).toContain("Paired devices");
    expect(enrolmentWarningsFor("keycloak")[0]).not.toContain("Paired devices");
    expect(warnLines().join("\n")).not.toMatch(/SECRET-(gh|kc)/);
  });

  it("#E93 a bounded config (allowedUsers) warns for no provider, google included", async () => {
    const providers = { github: gh, google: { ...gh } };
    const b = await build({ providers, allowedUsers: ["a@b.c"] });
    await reload(b, { providers, allowedUsers: ["a@b.c"] });
    expect(warnLines().filter((l: string) => l.includes("open enrolment"))).toHaveLength(0);
  });

  describe("GET /api/auth/diagnostics", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-diag-"));
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    function diagnosticsHost(app: FastifyInstance) {
      registerSystemRoutes(app, {
        sessionManager: {} as never,
        preferencesStore: { flush: () => {} } as never,
        metaPersistence: { flushAll: () => {} } as never,
        config: { port: PORT, piPort: 9999, dev: false } as never,
        networkGuard: (async () => {}) as never,
      } as never);
    }
    const diag = async (app: FastifyInstance) =>
      (await app.inject({ method: "GET", url: "/api/auth/diagnostics" })).json().data;

    it("#E94 (a) auth inactive → openEnrolment []", async () => {
      const app = Fastify();
      diagnosticsHost(app);
      await app.ready();
      apps.push(app);
      expect((await diag(app)).openEnrolment).toEqual([]);
    });

    it("#E94 (b) shape: github refused + keycloak open, no secrets; bounded google absent from allowlist config", async () => {
      const b = await build({ providers: { github: gh, keycloak: kc } });
      const bApp = b.app;
      // register the system route on a fresh sibling app that shares the decoration
      const app = Fastify();
      (app as any)._authOpenEnrolment = (bApp as any)._authOpenEnrolment;
      (app as any)._reloadAuth = (bApp as any)._reloadAuth;
      diagnosticsHost(app);
      await app.ready();
      apps.push(app);
      const data = await diag(app);
      expect(data.openEnrolment).toEqual([
        { provider: "github", mode: "refused" },
        { provider: "keycloak", mode: "open" },
      ]);
      expect(JSON.stringify(data)).not.toMatch(/SECRET|clientSecret/);

      await reload(b, { providers: { github: gh, keycloak: kc }, allowedUsers: ["a@b.c"] });
      expect((await diag(app)).openEnrolment).toEqual([]);
    });

    it("#E94 (c) reads LIVE state, not config.json: an unapplied file edit changes nothing", async () => {
      const b = await build({ providers: { github: gh } });
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ auth: { providers: { github: gh }, allowedUsers: ["octocat"] } }));
      const app = Fastify();
      (app as any)._authOpenEnrolment = (b.app as any)._authOpenEnrolment;
      diagnosticsHost(app);
      await app.ready();
      apps.push(app);
      expect((await diag(app)).openEnrolment).toEqual([{ provider: "github", mode: "refused" }]);
      fs.rmSync(CONFIG_FILE, { force: true });
    });

    it("#E95 tier: 401 unauthenticated, 403 observe/control, 200 operate; route-tiers entry unchanged", async () => {
      expect(ROUTE_TIERS.find((r) => r.method === "GET" && r.path === "/api/auth/diagnostics")?.tier).toBe("operate");
      await build({ providers: { github: gh }, allowedUsers: ["*@x"] });
      const app = Fastify();
      await registerAuthPlugin(app, { authConfig: { secret: SECRET, providers: { github: gh }, allowedUsers: ["*@x"] } as AuthConfig, port: PORT });
      app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
      diagnosticsHost(app);
      await app.ready();
      apps.push(app);
      const hit = (cookie?: string) =>
        app.inject({
          method: "GET",
          url: "/api/auth/diagnostics",
          remoteAddress: REMOTE,
          headers: cookie ? { cookie } : {},
        });
      expect((await hit()).statusCode).toBe(401);
      expect((await hit(jwtCookie("github", { tier: "observe" }))).statusCode).toBe(403);
      expect((await hit(jwtCookie("github", { tier: "control" }))).statusCode).toBe(403);
      expect((await hit(jwtCookie("github", { tier: "operate" }))).statusCode).toBe(200);
    });
  });

  it("#X18 audit/warn sinks failing do not break the refusal (logger throws → still 403, no 500)", async () => {
    const { app } = await build({ providers: { github: gh } });
    logSpy.mockImplementation(() => {
      throw new Error("sink down");
    });
    const s = await start(app, "github");
    expect(s.statusCode).toBe(403);
    expect(isRemedyPage(s.body)).toBe(true);
    expect((await login(app)).statusCode).toBe(403);
  });
});

// ─── #E96–#E100, #E111 already-issued sessions ──────────────────────────────

describe("already-issued sessions of a refused provider", () => {
  it("#E96 rejected on REST (JSON + HTML), /auth/status and WS upgrade", async () => {
    const { app, handle, config } = await build({ providers: { github: gh } });
    const cookie = jwtCookie("github"); // legacy: no tier claim

    const json = await ping(app, cookie);
    expect(json.statusCode).toBe(401);
    expect(json.json()).toEqual({ error: "Authentication required" });
    expect(sessionCookieCleared(json)).toBe(true);

    const html = await ping(app, cookie, "text/html");
    expect(html.statusCode).toBe(302);
    expect(html.headers.location).toBe(`/auth/login?return=${encodeURIComponent("/api/ping")}`);
    expect(sessionCookieCleared(html)).toBe(true);

    const status = await app.inject({ method: "GET", url: "/auth/status", headers: { cookie } });
    expect(status.json()).toEqual({ authenticated: false });

    const ws = authorizeWsUpgrade({
      cookieHeader: cookie,
      remoteAddress: REMOTE,
      secret: config.secret,
      scope: "browser",
      isSessionLive: (p) => effectiveSessionTier(p, undefined, handle.isSessionProviderRejected) !== null,
    });
    expect(ws.ok).toBe(false);
  });

  it("#E96 and the same cookie works once an allowlist is applied (no re-login needed)", async () => {
    const b = await build({ providers: { github: gh } });
    const cookie = jwtCookie("github");
    expect((await ping(b.app, cookie)).statusCode).toBe(401);
    await reload(b, { providers: { github: gh }, allowedUsers: ["a@x"] });
    expect((await ping(b.app, cookie)).statusCode).toBe(200);
  });

  it("#E97 a removed provider's session is rejected whatever the allowlist or key (github and corp-oidc)", async () => {
    const { app } = await build({ providers: { keycloak: kc }, allowedUsers: ["a@x"] });
    for (const provider of ["corp-oidc", "github"]) {
      const res = await ping(app, jwtCookie(provider));
      expect(res.statusCode, provider).toBe(401);
      expect(sessionCookieCleared(res), provider).toBe(true);
      const html = await ping(app, jwtCookie(provider), "text/html");
      expect(html.statusCode, provider).toBe(302);
    }
  });

  it("#E98 a discovery outage does not revoke a non-public provider's sessions", async () => {
    const b = await build({ providers: { keycloak: kc, github: gh }, allowedUsers: [] });
    // keycloak is non-public + open: valid. Discovery now fails at reload.
    failingHosts.add("sso.example.com");
    await reload(b, { providers: { keycloak: kc, github: gh } });
    expect(b.handle.hasUsableOAuthProvider()).toBe(true); // github remains
    const res = await ping(b.app, jwtCookie("keycloak"));
    expect(res.statusCode).toBe(200);
    expect(sessionCookieCleared(res)).toBe(false);
  });

  it("#E99 passkey and bearer sessions are unaffected; allowlist/groupTiers edits do not revoke allowed providers", async () => {
    // passkey: never reaches the provider rule, even when the accessor rejects everything
    const passkeys = { sessionTier: () => "observe" } as any;
    const payload = { sub: "u", name: "n", username: "n", provider: "passkey", exp: 9e9 } as any;
    expect(effectiveSessionTier(payload, passkeys, () => true)).toBe("observe");

    // bearer: admitted by an earlier hook, the OAuth hook never judges it
    const app = Fastify();
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", async (req) => {
      if (req.headers.authorization === "Bearer dev") (req as any).isAuthenticated = true;
    });
    await registerAuthPlugin(app, { authConfig: { secret: SECRET, providers: { github: gh } } as AuthConfig, port: PORT });
    app.get("/api/ping", async () => ({ ok: true }));
    await app.ready();
    apps.push(app);
    const bearer = await app.inject({ method: "GET", url: "/api/ping", remoteAddress: REMOTE, headers: { authorization: "Bearer dev" } });
    expect(bearer.statusCode).toBe(200);

    // CRED-03 residual pinned: a github JWT of a user NOT in the (edited) list stays valid
    const listed = await build({ providers: { github: gh }, allowedUsers: ["someone-else@x"] });
    expect((await ping(listed.app, jwtCookie("github"))).statusCode).toBe(200);
    const grouped = await build({ providers: { github: gh }, groupTiers: { ops: "operate" } });
    expect((await ping(grouped.app, jwtCookie("github"))).statusCode).toBe(200);
  });

  it.each([
    ["no provider claim", () => jwt.sign({ sub: "a@x", name: "A", username: "a" }, SECRET, { algorithm: "HS256" })],
    ["empty provider", () => jwt.sign({ sub: "a@x", name: "A", username: "a", provider: "" }, SECRET, { algorithm: "HS256" })],
    ["numeric provider", () => jwt.sign({ sub: "a@x", name: "A", username: "a", provider: 123 }, SECRET, { algorithm: "HS256" })],
  ])("#E100 JWT with %s is rejected (G14, fail closed) even with an allowlist", async (_n, mint) => {
    const { app } = await build({ providers: { github: gh }, allowedUsers: ["a@x"] });
    const res = await ping(app, `${COOKIE_NAME}=${mint()}`);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Authentication required" });
    expect(sessionCookieCleared(res)).toBe(true);
  });

  it("#E103 live-preview upgrade by a refused provider's cookie is refused at the door (isSessionLive)", async () => {
    const { handle, config } = await build({ providers: { github: gh } });
    const res = authorizeWsUpgrade({
      cookieHeader: jwtCookie("github"),
      remoteAddress: REMOTE,
      secret: config.secret,
      scope: "live",
      isSessionLive: (p) => effectiveSessionTier(p, undefined, handle.isSessionProviderRejected) !== null,
    });
    expect(res.ok).toBe(false);
  });

  it("#E111 a malformed provider entry is dropped by config validation and counts as removed", async () => {
    const b = await build({ providers: { github: gh, keycloak: kc }, allowedUsers: ["a@x"] });
    expect((await ping(b.app, jwtCookie("github"))).statusCode).toBe(200);

    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify({ auth: { secret: SECRET, providers: { github: { clientId: "x" }, keycloak: kc } } }),
    );
    const loaded = loadConfig().auth as AuthConfig;
    fs.rmSync(CONFIG_FILE, { force: true });
    expect(Object.keys(loaded.providers)).toEqual(["keycloak"]); // github dropped by validation

    warnSpy.mockClear();
    await reload(b, loaded);
    const res = await ping(b.app, jwtCookie("github"));
    expect(res.statusCode).toBe(401);
    expect(sessionCookieCleared(res)).toBe(true);
    expect(enrolmentWarningsFor("github")).toHaveLength(0);
    expect((b.app as any)._authOpenEnrolment().map((e: { provider: string }) => e.provider)).not.toContain("github");
  });
});
