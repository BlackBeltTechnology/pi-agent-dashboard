/**
 * node:test — D22 DASHBOARD-UI (handoff) mode of the login plane.
 *
 * The dashboard SPA calls `/identity-login/start?returnTo=…&challenge=…`. The
 * plugin redirects to the IdP at once (no page of its own), exchanges the IdP
 * code server-side, and returns `returnTo#pi_handoff=<one-time code>`. The SPA
 * redeems that code at `POST /identity-login/token {code, verifier}`; the code
 * is bound to the SPA's S256 challenge, single-use and short-lived.
 * NO cookies in this mode (D22) — the challenge binding replaces the browser
 * binding cookie.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { BASE_PATH, registerIdentityLoginRoutes } from "../lib/identity-routes.mjs";

const HOST = "dash.example:8010";
const ORIGIN = `http://${HOST}`;
const TOKEN = "HANDOFF-access-token";
const ID_TOKEN = "aGVhZGVy.cGF5bG9hZA.c2ln";
const VERIFIER = "spa-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubIssuer({ discoveryStatus = 200, tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, body: init.body });
    if (u.endsWith("/.well-known/openid-configuration")) {
      if (discoveryStatus !== 200) return json({}, discoveryStatus);
      return json({ authorization_endpoint: "https://kc.example/authorize", token_endpoint: "https://kc.example/token", end_session_endpoint: "https://kc.example/end-session" });
    }
    if (u === "https://kc.example/token") return tokenStatus === 200 ? json({ access_token: TOKEN, id_token: ID_TOKEN, expires_in: 300 }) : json({}, tokenStatus);
    return json({}, 404);
  };
  return { fetchImpl, calls };
}

async function buildApp(opts = {}) {
  const app = Fastify();
  const stub = stubIssuer(opts.issuer);
  const lines = [];
  const log = (lvl) => (...a) => lines.push(`${lvl} ${a.join(" ")}`);
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  registerIdentityLoginRoutes(app, {
    issuer: "https://kc.example",
    clientId: "dashboard-web",
    fetchImpl: stub.fetchImpl,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
    now: clock.now,
  });
  await app.ready();
  return { app, stub, lines, clock };
}

const start = (app, returnTo = "/session/abc", challenge = CHALLENGE) =>
  app.inject({ method: "GET", url: `${BASE_PATH}/start?returnTo=${encodeURIComponent(returnTo)}&challenge=${challenge}`, headers: { host: HOST } });

async function loginToHandoff(app, returnTo) {
  const s = await start(app, returnTo);
  const state = new URL(s.headers.location).searchParams.get("state");
  const cb = await app.inject({ method: "GET", url: `${BASE_PATH}/callback?code=idp-code&state=${state}`, headers: { host: HOST } });
  return { s, cb, loc: new URL(cb.headers.location) };
}

const redeem = (app, code, verifier = VERIFIER) =>
  app.inject({ method: "POST", url: `${BASE_PATH}/token`, headers: { host: HOST, "content-type": "application/json" }, payload: { code, verifier } });

test("start with a challenge redirects STRAIGHT to the IdP and sets NO cookie", async () => {
  const { app } = await buildApp();
  const res = await start(app);
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.location).origin, "https://kc.example");
  assert.equal(res.headers["set-cookie"], undefined);
});

test("callback returns to returnTo on the STARTED origin with #pi_handoff, never the token", async () => {
  const { app } = await buildApp();
  const { cb, loc } = await loginToHandoff(app, "/session/abc?tab=x");
  assert.equal(cb.statusCode, 302);
  assert.equal(loc.origin, ORIGIN);
  assert.equal(`${loc.pathname}${loc.search}`, "/session/abc?tab=x");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  assert.ok(code && code.length >= 20);
  assert.ok(!cb.headers.location.includes(TOKEN), "the bearer never rides a URL");
  assert.equal(cb.headers["set-cookie"], undefined);
});

test("an off-origin or scheme-relative returnTo collapses to /", async () => {
  const { app } = await buildApp();
  for (const bad of ["https://evil.example/x", "//evil.example/x"]) {
    const { loc } = await loginToHandoff(app, bad);
    assert.equal(loc.origin, ORIGIN);
    assert.equal(loc.pathname, "/");
  }
});

test("token: the code redeems ONCE with the matching verifier", async () => {
  const { app } = await buildApp();
  const { loc } = await loginToHandoff(app, "/");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  const ok = await redeem(app, code);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { access_token: TOKEN, expires_in: 300, id_token: ID_TOKEN });
  const again = await redeem(app, code);
  assert.equal(again.statusCode, 400, "single-use");
});

test("token: a wrong verifier is refused and burns the code (code injection / login CSRF)", async () => {
  const { app } = await buildApp();
  const { loc } = await loginToHandoff(app, "/");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  assert.equal((await redeem(app, code, "attacker-verifier")).statusCode, 400);
  assert.equal((await redeem(app, code)).statusCode, 400, "burned after a failed attempt");
});

test("token: an expired code is refused (≤60 s)", async () => {
  const { app, clock } = await buildApp();
  const { loc } = await loginToHandoff(app, "/");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  clock.advance(61_000);
  assert.equal((await redeem(app, code)).statusCode, 400);
});

test("IdP unreachable in handoff mode returns to the dashboard with #pi_login_error", async () => {
  const { app } = await buildApp({ issuer: { discoveryStatus: 503 } });
  const res = await start(app, "/session/abc");
  assert.equal(res.statusCode, 302);
  const loc = new URL(res.headers.location, ORIGIN);
  assert.equal(loc.origin, ORIGIN);
  assert.equal(loc.pathname, "/session/abc");
  assert.equal(new URLSearchParams(loc.hash.slice(1)).get("pi_login_error"), "idp_unreachable");
});

test("token exchange failure returns #pi_login_error, not a plugin page", async () => {
  const { app } = await buildApp({ issuer: { tokenStatus: 400 } });
  const { loc } = await loginToHandoff(app, "/");
  assert.equal(new URLSearchParams(loc.hash.slice(1)).get("pi_login_error"), "exchange_failed");
});

test("signout ends the IdP session and lands on the dashboard signed-out marker", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/signout?returnTo=%2F`, headers: { host: HOST } });
  assert.equal(res.statusCode, 302);
  const u = new URL(res.headers.location);
  assert.equal(u.origin, "https://kc.example");
  assert.equal(u.pathname, "/end-session");
  assert.equal(u.searchParams.get("post_logout_redirect_uri"), `${ORIGIN}/login?pi_signed_out=1`);
});

test("the access token and handoff code are never logged", async () => {
  const { app, lines } = await buildApp();
  const { loc } = await loginToHandoff(app, "/");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  await redeem(app, code);
  const all = lines.join("\n");
  assert.ok(!all.includes(TOKEN));
  assert.ok(!all.includes(code));
});

// ── Silent sign-in (prompt=none): a live IdP session signs in with no click ──

test("start with prompt=none forwards prompt=none to the IdP authorize request", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/start?returnTo=%2F&challenge=${CHALLENGE}&prompt=none`, headers: { host: HOST } });
  assert.equal(new URL(res.headers.location).searchParams.get("prompt"), "none");
});

test("start never forwards any other prompt value", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/start?returnTo=%2F&challenge=${CHALLENGE}&prompt=login`, headers: { host: HOST } });
  assert.equal(new URL(res.headers.location).searchParams.get("prompt"), null);
});

test("no IdP session (login_required) returns to the dashboard as #pi_login_error=login_required", async () => {
  const { app } = await buildApp();
  const s = await start(app, "/session/abc");
  const state = new URL(s.headers.location).searchParams.get("state");
  const cb = await app.inject({ method: "GET", url: `${BASE_PATH}/callback?error=login_required&state=${state}`, headers: { host: HOST } });
  assert.equal(cb.statusCode, 302);
  assert.equal(cb.headers.location, `${ORIGIN}/session/abc#pi_login_error=login_required`);
});

test("any other IdP error in handoff mode returns as #pi_login_error=denied (never the raw text)", async () => {
  const { app } = await buildApp();
  const s = await start(app, "/");
  const state = new URL(s.headers.location).searchParams.get("state");
  const cb = await app.inject({ method: "GET", url: `${BASE_PATH}/callback?error=%3Cscript%3E&state=${state}`, headers: { host: HOST } });
  assert.equal(cb.headers.location, `${ORIGIN}/#pi_login_error=denied`);
});

// ── Sign-out without Keycloak's "Do you want to log out?" page ──

test("redeem also returns the IdP id_token (kept in the SPA's memory for id_token_hint)", async () => {
  const { app } = await buildApp();
  const { loc } = await loginToHandoff(app, "/");
  const code = new URLSearchParams(loc.hash.slice(1)).get("pi_handoff");
  const res = await redeem(app, code);
  assert.equal(res.json().id_token, ID_TOKEN);
});

test("signout forwards a well-formed id_token_hint to end_session (IdP skips its confirm page)", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/signout?id_token_hint=${ID_TOKEN}`, headers: { host: HOST } });
  const u = new URL(res.headers.location);
  assert.equal(u.searchParams.get("id_token_hint"), ID_TOKEN);
  assert.equal(u.searchParams.get("post_logout_redirect_uri"), `${ORIGIN}/login?pi_signed_out=1`);
});

test("signout drops a malformed or oversized id_token_hint", async () => {
  const { app } = await buildApp();
  for (const bad of ["not-a-jwt", "a.b", `${"x".repeat(9000)}.y.z`, "a.b.c<script>"]) {
    const res = await app.inject({ method: "GET", url: `${BASE_PATH}/signout?id_token_hint=${encodeURIComponent(bad)}`, headers: { host: HOST } });
    assert.equal(new URL(res.headers.location).searchParams.get("id_token_hint"), null, bad.slice(0, 20));
  }
});
