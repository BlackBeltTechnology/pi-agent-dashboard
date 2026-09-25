import { createHash, randomBytes } from "node:crypto";
import { decodeJwt } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "../fake-oidc-issuer.js";

// Interactive authorization-code + PKCE flow for browser E2E (D21 setup matrix).
// The fake issuer stays tiny: one login form, single-use codes, an SSO cookie,
// and RP-initiated logout — enough to drive a real login-plane plugin.

const REDIRECT = "http://localhost:9999/identity-login/callback";
const POST_LOGOUT = "http://localhost:9999/identity-login/";
const USERS = [
  { username: "anna", password: "anna-pw", sub: "sub-anna", email: "anna@example.test" },
  { username: "bela", password: "bela-pw", sub: "sub-bela" },
];

let issuer: FakeOidcIssuer;
afterEach(async () => {
  await issuer?.close();
});

const b64url = (b: Buffer) => b.toString("base64url");
function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}
function authorizeUrl(challenge: string, extra: Record<string, string> = {}) {
  const u = new URL(`${issuer.issuer}/auth`);
  for (const [k, v] of Object.entries({
    response_type: "code",
    client_id: "dashboard-web",
    redirect_uri: REDIRECT,
    scope: "openid",
    state: "st-1",
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...extra,
  }))
    u.searchParams.set(k, v);
  return u.toString();
}
async function submitLogin(challenge: string, username: string, password: string, cookie?: string) {
  const form = new URLSearchParams({ username, password, query: new URL(authorizeUrl(challenge)).search.slice(1) });
  return fetch(`${issuer.issuer}/auth`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
    body: form,
  });
}
async function exchange(code: string, verifier: string, redirectUri = REDIRECT) {
  return fetch(`${issuer.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: "dashboard-web", code_verifier: verifier }),
  });
}
const start = () =>
  startFakeOidcIssuer({ users: USERS, redirectUriPrefixes: ["http://localhost:9999/"] }).then((i) => {
    issuer = i;
    return i;
  });

describe("fake OIDC issuer — interactive auth-code flow", () => {
  it("advertises authorize, token and end_session endpoints", async () => {
    await start();
    const disc = await (await fetch(`${issuer.issuer}/.well-known/openid-configuration`)).json();
    expect(disc.authorization_endpoint).toBe(`${issuer.issuer}/auth`);
    expect(disc.token_endpoint).toBe(`${issuer.issuer}/token`);
    expect(disc.end_session_endpoint).toBe(`${issuer.issuer}/logout`);
  });

  it("renders a login form with Keycloak-compatible field ids", async () => {
    await start();
    const html = await (await fetch(authorizeUrl(pkce().challenge))).text();
    expect(html).toContain('id="username"');
    expect(html).toContain('id="password"');
    expect(html).toContain('id="kc-login"');
  });

  it("valid credentials redirect to redirect_uri with code+state, and the code exchanges (PKCE) for a user token", async () => {
    await start();
    const { verifier, challenge } = pkce();
    const res = await submitLogin(challenge, "anna", "anna-pw");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("st-1");
    const tok = await exchange(loc.searchParams.get("code") ?? "", verifier);
    expect(tok.status).toBe(200);
    const body = await tok.json();
    expect(body.token_type).toBe("Bearer");
    const claims = decodeJwt(body.access_token);
    expect(claims.sub).toBe("sub-anna");
    expect(claims.iss).toBe(issuer.issuer);
    expect(claims.aud).toBe("pi-dashboard");
  });

  it("rejects wrong credentials without redirecting", async () => {
    await start();
    const res = await submitLogin(pkce().challenge, "anna", "nope");
    expect(res.status).toBe(401);
  });

  it("codes are single-use and PKCE-bound", async () => {
    await start();
    const { verifier, challenge } = pkce();
    const code = new URL((await submitLogin(challenge, "anna", "anna-pw")).headers.get("location") ?? "").searchParams.get("code") ?? "";
    expect((await exchange(code, "wrong-verifier")).status).toBe(400);
    expect((await exchange(code, verifier)).status).toBe(400); // burned by the failed attempt
  });

  it("refuses a redirect_uri outside the allowlist", async () => {
    await start();
    const res = await fetch(authorizeUrl(pkce().challenge, { redirect_uri: "http://evil.test/cb" }));
    expect(res.status).toBe(400);
  });

  it("an SSO cookie skips the form; end_session clears it and redirects to an allowed post_logout_redirect_uri", async () => {
    await start();
    const login = await submitLogin(pkce().challenge, "anna", "anna-pw");
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    expect(cookie).toMatch(/^fake_oidc_sso=/);
    const sso = await fetch(authorizeUrl(pkce().challenge), { redirect: "manual", headers: { cookie } });
    expect(sso.status).toBe(302);
    const out = await fetch(`${issuer.issuer}/logout?post_logout_redirect_uri=${encodeURIComponent(POST_LOGOUT)}`, {
      redirect: "manual",
      headers: { cookie },
    });
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe(POST_LOGOUT);
    expect(out.headers.get("set-cookie") ?? "").toMatch(/fake_oidc_sso=;.*Max-Age=0/);
    const bad = await fetch(`${issuer.issuer}/logout?post_logout_redirect_uri=${encodeURIComponent("http://evil.test/")}`, { redirect: "manual" });
    expect(bad.status).toBe(400);
  });

  it("prompt=none: no SSO session ⇒ redirect_uri?error=login_required&state (OIDC §3.1.2.6), never the form", async () => {
    await start();
    const res = await fetch(authorizeUrl(pkce().challenge, { prompt: "none" }), { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(`${loc.origin}${loc.pathname}`).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe("login_required");
    expect(loc.searchParams.get("state")).toBe("st-1");
  });

  it("prompt=none with a live SSO session ⇒ a code, silently", async () => {
    await start();
    const login = await submitLogin(pkce().challenge, "anna", "anna-pw");
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const res = await fetch(authorizeUrl(pkce().challenge, { prompt: "none" }), { redirect: "manual", headers: { cookie } });
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("code")).toBeTruthy();
  });

  it("without `users` the interactive endpoints stay off (mint-only, unchanged)", async () => {
    issuer = await startFakeOidcIssuer();
    expect((await fetch(authorizeUrl(pkce().challenge))).status).toBe(404);
  });
});
