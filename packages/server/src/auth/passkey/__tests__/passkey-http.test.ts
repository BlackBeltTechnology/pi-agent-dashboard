/**
 * HTTP-level passkey flows through the real auth plugin, user routes and
 * route-tier gate (fastify.inject + software authenticator).
 * See change: add-passkey-user-auth (passkey-user-auth: all requirements;
 * oauth-authentication › Session tier claim; tasks 4B.2–4B.4, 3.2, 3.5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorizeWsUpgrade, effectiveSessionTier, registerAuthPlugin } from "../../auth-plugin.js";
import { verifyToken } from "../../auth.js";
import { createRouteTierGate } from "../../route-tier-gate.js";
import { registerUserRoutes } from "../../../routes/user-routes.js";
import { PASSKEY_PROVIDER, PasskeyService } from "../passkey-service.js";
import { computeRpContext, type RpContext } from "../rp-context.js";
import { UserDirectory } from "../user-directory.js";
import { createCredential, getAssertion, type SoftCredential } from "./soft-authenticator.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const ORIGIN = "https://host.tailnet.ts.net";
const HOST = "host.tailnet.ts.net";
const REMOTE = "203.0.113.5";
const LOCAL = "127.0.0.1";

let dir: string;
let app: FastifyInstance | undefined;
let service: PasskeyService;
let rp: RpContext;
let logs: string[];

async function build(auth: Partial<AuthConfig> = {}) {
  await app?.close();
  service = new PasskeyService({
    directory: new UserDirectory(path.join(dir, "users.json")),
    // Honour an override like resolveRpContext does; else the test's primary.
    getRpContext: (override) =>
      override ? computeRpContext({ base: override, source: "auth.redirectBaseUrl", primary: "tailscale" }) : rp,
    log: (l) => logs.push(l),
  });
  app = Fastify();
  await registerAuthPlugin(app, {
    authConfig: { secret: SECRET, providers: {}, passkeys: { enabled: true }, ...auth } as AuthConfig,
    port: 8000,
    passkeys: service,
  });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  registerUserRoutes(app, {
    service,
    hostAdmission: () => ({ allowedHosts: [HOST], publicBaseUrls: [], configuredOrigins: [], getLiveTunnelOrigins: () => [], bindHost: "localhost" }),
    log: (l) => logs.push(l),
  });
  app.post("/api/restart", async () => ({ ok: true }));
  app.get("/api/sessions", async () => ({ ok: true }));
  await app.ready();
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-passkey-http-"));
  rp = { rpOrigin: ORIGIN, rpId: HOST, stable: true };
  logs = [];
  await build();
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { headers: Record<string, any> }) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("pi_dash_token="))?.split(";")[0];
const local = (method: any, url: string, payload?: unknown) => app!.inject({ method, url, remoteAddress: LOCAL, payload: payload as any });
const remote = (method: any, url: string, cookie?: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app!.inject({ method, url, remoteAddress: REMOTE, headers: { host: HOST, ...(cookie ? { cookie } : {}), ...extra }, payload: payload as any });

/** Bootstrap operator locally, then create+enroll a user; returns its credential + session cookie. */
async function addUser(name: string, tier: "observe" | "control" | "operate") {
  if (service.directory.isEmpty()) {
    const boot = await local("POST", "/api/users", { name: "Root" });
    expect(boot.statusCode).toBe(200);
  }
  const created = await local("POST", "/api/users", { name, tier });
  const id = created.json().data.id as string;
  const inv = await local("POST", `/api/users/${id}/invites`, {});
  expect(inv.statusCode).toBe(200);
  const token = new URL(inv.json().data.url).hash.slice(1);
  const origin = service.rpContext().rpOrigin;
  const opts = await remote("POST", "/auth/passkey/register/options", undefined, { token }, { origin });
  const { response, credential } = createCredential(opts.json().options, origin);
  const verify = await remote("POST", "/auth/passkey/register/verify", undefined, { challengeId: opts.json().challengeId, token, response }, { origin });
  expect(verify.statusCode).toBe(200);
  return { id, credential, cookie: cookieOf(verify)! };
}

async function passkeyLogin(credential: SoftCredential) {
  const o = await remote("POST", "/auth/passkey/login/options");
  return remote("POST", "/auth/passkey/login/verify", undefined, { challengeId: o.json().challengeId, response: getAssertion(credential, o.json().options, ORIGIN) });
}

describe("user directory routes", () => {
  it("first operator is bootstrapped locally with tier operate; remote bootstrap is refused", async () => {
    const r = await remote("POST", "/api/users", undefined, { name: "Remote" });
    expect(r.statusCode).toBe(401); // no credential at all
    const boot = await local("POST", "/api/users", { name: "Root", tier: "observe" });
    expect(boot.json().data).toMatchObject({ name: "Root", tier: "operate", status: "invited" });
  });

  it("a remote operate session cannot bootstrap an empty directory", async () => {
    await build({ providers: {} });
    const { signToken } = await import("../../auth.js");
    const cookie = `pi_dash_token=${signToken({ sub: "a@x", name: "A", username: "a", provider: "github", tier: "operate" }, SECRET)}`;
    const r = await remote("POST", "/api/users", cookie, { name: "X" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("bootstrap_local_only");
  });

  it("operator adds Anna (observe) → invited", async () => {
    await local("POST", "/api/users", { name: "Root" });
    const r = await local("POST", "/api/users", { name: "Anna", tier: "observe" });
    expect(r.json().data).toMatchObject({ name: "Anna", tier: "observe", status: "invited" });
  });

  it("non-operator sessions and device bearers cannot manage users", async () => {
    const anna = await addUser("Anna", "observe");
    const ctl = await addUser("Carl", "control");
    for (const cookie of [anna.cookie, ctl.cookie]) {
      const r = await remote("POST", "/api/users", cookie, { name: "X", tier: "operate" });
      expect([401, 403]).toContain(r.statusCode);
      const t = await remote("PATCH", `/api/users/${anna.id}`, cookie, { tier: "operate" });
      expect([401, 403]).toContain(t.statusCode);
    }
    expect(service.directory.list().map((u) => u.name).sort()).toEqual(["Anna", "Carl", "Root"]);
    expect(service.directory.get(anna.id)!.tier).toBe("observe");
  });

  it("an operate passkey session manages users remotely", async () => {
    const op = await addUser("Olga", "operate");
    const r = await remote("POST", "/api/users", op.cookie, { name: "Bob", tier: "control" }, { origin: ORIGIN });
    expect(r.statusCode).toBe(200);
    const list = await remote("GET", "/api/users", op.cookie);
    expect(list.json().data.users.map((u: any) => u.name)).toContain("Bob");
    // no credential ids or token hashes in the listing
    expect(JSON.stringify(list.json())).not.toMatch(/tokenHash|publicKey|"id":"[A-Za-z0-9_-]{22}"/);
  });

  it("invite minting is 409 unstable_origin on an ephemeral primary", async () => {
    await local("POST", "/api/users", { name: "Root" });
    const u = await local("POST", "/api/users", { name: "Anna", tier: "observe" });
    rp = { rpOrigin: "https://x.share.zrok.io", rpId: "x.share.zrok.io", stable: false, reason: "ephemeral_tunnel" };
    const r = await local("POST", `/api/users/${u.json().data.id}/invites`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("unstable_origin");
  });

  it("invite response carries a URL on the primary origin, token in the fragment, and a QR", async () => {
    await local("POST", "/api/users", { name: "Root" });
    const u = await local("POST", "/api/users", { name: "Anna", tier: "observe" });
    const r = await local("POST", `/api/users/${u.json().data.id}/invites`, {});
    const { url, qrDataUrl } = r.json().data;
    expect(url).toMatch(/^https:\/\/host\.tailnet\.ts\.net\/auth\/invite#[A-Za-z0-9_-]{43}$/);
    expect(qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(logs.some((l) => /^\[passkey\] invite_created id=[0-9a-f]{8}$/.test(l))).toBe(true);
  });
});

describe("passkey login over HTTP", () => {
  it("successful login sets pi_dash_token with sub=user and the user's tier", async () => {
    const anna = await addUser("Anna", "observe");
    const res = await passkeyLogin(anna.credential);
    expect(res.statusCode).toBe(200);
    const payload = verifyToken(cookieOf(res)!.split("=")[1]!, SECRET)!;
    expect(payload).toMatchObject({ sub: anna.id, tier: "observe", provider: PASSKEY_PROVIDER });
  });

  it("observe passkey session: reads allowed, operate route refused", async () => {
    const anna = await addUser("Anna", "observe");
    expect((await remote("GET", "/api/sessions", anna.cookie)).statusCode).toBe(200);
    expect((await remote("POST", "/api/restart", anna.cookie)).statusCode).toBe(403);
  });

  it("revocation takes effect at the next request (REST and WS)", async () => {
    const anna = await addUser("Anna", "observe");
    expect((await remote("GET", "/api/sessions", anna.cookie)).statusCode).toBe(200);
    const rev = await local("POST", `/api/users/${anna.id}/revoke`);
    expect(rev.statusCode).toBe(200);
    expect((await remote("GET", "/api/sessions", anna.cookie)).statusCode).toBe(401);
    const ws = authorizeWsUpgrade({
      cookieHeader: anna.cookie,
      remoteAddress: REMOTE,
      secret: SECRET,
      isSessionLive: (p) => p.provider !== PASSKEY_PROVIDER || service.sessionTier(p) !== null,
    });
    expect(ws.ok).toBe(false);
    expect(logs.some((l) => l.startsWith("[passkey] revoked id="))).toBe(true);
  });

  it("WS upgrade by session cookie reports the session (tier-gateable); loopback does not", async () => {
    const anna = await addUser("Anna", "observe");
    const viaCookie = authorizeWsUpgrade({ cookieHeader: anna.cookie, remoteAddress: REMOTE, secret: SECRET });
    expect(viaCookie.ok).toBe(true);
    expect(viaCookie.session).toMatchObject({ sub: anna.id, provider: PASSKEY_PROVIDER });
    expect(effectiveSessionTier(viaCookie.session!, service)).toBe("observe");
    const viaLoopback = authorizeWsUpgrade({ cookieHeader: anna.cookie, remoteAddress: LOCAL, secret: SECRET });
    expect(viaLoopback).toEqual({ ok: true });
  });

  it("re-tier applies at the next request", async () => {
    const anna = await addUser("Anna", "observe");
    expect((await remote("POST", "/api/restart", anna.cookie)).statusCode).toBe(403);
    await local("PATCH", `/api/users/${anna.id}`, { tier: "operate" });
    expect((await remote("POST", "/api/restart", anna.cookie)).statusCode).toBe(200);
  });

  it("cross-site POST to a ceremony route is refused", async () => {
    const r = await remote("POST", "/auth/passkey/login/options", undefined, {}, { origin: "https://evil.example" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe("origin_mismatch");
  });

  it("disabled passkeys make ceremony routes inert and passkey cookies dead", async () => {
    const anna = await addUser("Anna", "observe");
    service.configure({ passkeys: { enabled: false } });
    expect((await remote("POST", "/auth/passkey/login/options")).statusCode).toBe(404);
    expect((await remote("GET", "/api/sessions", anna.cookie)).statusCode).toBe(401);
  });
});

describe("login page", () => {
  it("offers passkey + phone alongside OAuth providers (no single-provider auto-redirect)", async () => {
    await build({ providers: {} });
    const res = await app!.inject({ method: "GET", url: "/auth/login" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Sign in with passkey");
    expect(res.body).toContain("Sign in with phone");
    expect(res.body).not.toMatch(/<button[^>]*disabled[^>]*>Sign in with passkey/);
  });

  it("unstable origin: options are shown disabled with the reason, not hidden", async () => {
    rp = { rpOrigin: "https://x.share.zrok.io", rpId: "x.share.zrok.io", stable: false, reason: "ephemeral_tunnel" };
    const res = await app!.inject({ method: "GET", url: "/auth/login" });
    expect(res.body).toMatch(/<button[^>]*disabled[^>]*>Sign in with passkey/);
    expect(res.body).toMatch(/<button[^>]*disabled[^>]*>Sign in with phone/);
    expect(res.body).toContain("temporary (ephemeral tunnel)");
  });

  it("every inline page script parses (login, invite, phone)", async () => {
    const pages = [
      (await app!.inject({ method: "GET", url: "/auth/login?return=%2Fsessions" })).body,
      (await remote("GET", "/auth/invite")).body,
      (await remote("GET", "/auth/phone")).body,
    ];
    let scripts = 0;
    for (const html of pages) {
      // Case-insensitive, attribute/whitespace tolerant; `src=` tags have no body.
      for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)) {
        if (!m[1]!.trim()) continue;
        scripts++;
        // Function() parses without executing: a syntax error throws here.
        expect(() => new Function(m[1]!)).not.toThrow();
      }
    }
    expect(scripts).toBe(3);
  });

  it("login ?error= is HTML-escaped (reflected XSS)", async () => {
    const res = await app!.inject({ method: "GET", url: `/auth/login?error=${encodeURIComponent("<img src=x onerror=alert(1)>")}` });
    expect(res.body).not.toContain("<img src=x");
    expect(res.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("return path is embedded JSON-escaped (no </script> breakout)", async () => {
    const res = await app!.inject({ method: "GET", url: `/auth/login?return=${encodeURIComponent("/x</script><script>alert(1)</script>")}` });
    expect(res.body).not.toContain("<script>alert(1)");
  });

  it("serves the WebAuthn browser bundle and the invite/phone pages pre-auth", async () => {
    const js = await remote("GET", "/auth/passkey/webauthn.js");
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("SimpleWebAuthnBrowser");
    expect((await remote("GET", "/auth/invite")).statusCode).toBe(200);
    expect((await remote("GET", "/auth/phone")).statusCode).toBe(200);
  });
});

describe("sign in with phone over HTTP", () => {
  it("phone approves → desktop poll receives a session for the approver, once", async () => {
    const anna = await addUser("Anna", "control");
    const start = await remote("POST", "/auth/passkey/phone/start", undefined, {}, { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0" });
    expect(start.statusCode).toBe(200);
    const { requestId, shortCode, qrDataUrl } = start.json();
    expect(qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(qrDataUrl.split(",")[1], "base64").toString();
    expect(svg).toContain("<svg");

    // phone: typed code → approval token → view
    const look = await remote("POST", "/auth/passkey/phone/lookup", undefined, { code: shortCode });
    const token = look.json().approvalToken;
    const view = await remote("POST", "/auth/passkey/phone/view", undefined, { token });
    expect(view.json().requester).toMatchObject({ browser: "Chrome", os: "Windows" });

    expect((await remote("GET", `/auth/passkey/phone/poll/${requestId}`)).json().status).toBe("pending");
    const o = await remote("POST", "/auth/passkey/login/options");
    const ap = await remote("POST", "/auth/passkey/phone/approve", undefined, {
      token,
      challengeId: o.json().challengeId,
      response: getAssertion(anna.credential, o.json().options, ORIGIN),
    });
    expect(ap.statusCode).toBe(200);

    const poll = await remote("GET", `/auth/passkey/phone/poll/${requestId}`);
    expect(poll.json().status).toBe("approved");
    const payload = verifyToken(cookieOf(poll)!.split("=")[1]!, SECRET)!;
    expect(payload).toMatchObject({ sub: anna.id, tier: "control" });
    const again = await remote("GET", `/auth/passkey/phone/poll/${requestId}`);
    expect(cookieOf(again)).toBeUndefined();
  });

  it("phone denies → desktop sees rejected, no session", async () => {
    const start = await remote("POST", "/auth/passkey/phone/start");
    const token = (await remote("POST", "/auth/passkey/phone/lookup", undefined, { code: start.json().shortCode })).json().approvalToken;
    expect((await remote("POST", "/auth/passkey/phone/deny", undefined, { token })).statusCode).toBe(200);
    const poll = await remote("GET", `/auth/passkey/phone/poll/${start.json().requestId}`);
    expect(poll.json().status).toBe("rejected");
    expect(cookieOf(poll)).toBeUndefined();
  });

  it("phone start is 409 on an unstable origin", async () => {
    rp = { rpOrigin: "https://x.share.zrok.io", rpId: "x.share.zrok.io", stable: false, reason: "ephemeral_tunnel" };
    expect((await remote("POST", "/auth/passkey/phone/start")).statusCode).toBe(409);
  });
});

describe("primary switch impact (3.2/3.5)", () => {
  it("reports orphan counts for a different RP ID; zero for the same", async () => {
    await addUser("A", "observe");
    await addUser("B", "observe");
    const diff = await local("GET", "/api/users/credentials/impact?url=https%3A%2F%2Fnew.example.com");
    expect(diff.json().data).toMatchObject({ currentRpId: HOST, nextRpId: "new.example.com", orphaned: 2, users: 2 });
    const same = await local("GET", `/api/users/credentials/impact?rpId=${HOST}`);
    expect(same.json().data).toMatchObject({ orphaned: 0, users: 0 });
  });

  it("clearing auth.redirectBaseUrl reports what falling back to the primary would orphan", async () => {
    await build({ redirectBaseUrl: "https://dash.example.com" });
    await addUser("A", "observe"); // enrolled under dash.example.com
    const cleared = await local("GET", "/api/users/credentials/impact?redirectBaseUrl=");
    expect(cleared.json().data).toMatchObject({ currentRpId: "dash.example.com", nextRpId: HOST, orphaned: 1, users: 1 });
    const unchanged = await local("GET", `/api/users/credentials/impact?redirectBaseUrl=${encodeURIComponent("https://dash.example.com")}`);
    expect(unchanged.json().data).toMatchObject({ orphaned: 0 });
  });

  it("listing marks credentials under another RP ID as orphaned", async () => {
    await addUser("A", "observe");
    rp = { rpOrigin: "https://new.example.com", rpId: "new.example.com", stable: true };
    const list = await local("GET", "/api/users");
    const a = list.json().data.users.find((u: any) => u.name === "A");
    expect(a.credentials[0]).toMatchObject({ rpId: HOST, orphaned: true });
  });
});
