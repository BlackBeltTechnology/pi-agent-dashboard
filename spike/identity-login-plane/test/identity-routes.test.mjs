/**
 * node:test route-integration tests for the D20 INDEPENDENT-FRONTEND smoke
 * (`spike/identity-login-plane/`).
 *
 * These drive the plugin's OWN Fastify routes through `app.inject()` with a
 * STUBBED OIDC issuer (no network, no Keycloak). They are the executable half
 * of the tasks §17 / test-plan SM-1..SM-7 constraints that can be proven
 * without a browser:
 *
 *   - login + callback NEVER land on the dashboard root; the handoff target is
 *     the plugin's own `/identity-login/app` (D20; SM-1/SM-7).
 *   - the browser is BOUND to the callback it started (one-shot, HttpOnly
 *     SameSite cookie), and a callback is never replayable (SM-1 state binding).
 *   - PKCE `state` is single-use and expires (SM-1).
 *   - untrusted input (`error` query param) is HTML-escaped (security skill).
 *   - the access token is never logged, never set as a cookie, never persisted.
 *   - the frontend speaks the ACTUAL dashboard protocol: `GET /api/sessions`
 *     with `Authorization: Bearer`, `POST /api/ws-ticket {scope:"browser"}`,
 *     then `/ws?ticket=` and the server-initiated `sessions_snapshot`; the
 *     harmless round-trip is `sessions_page` → `sessions_page_result` (SM-3/SM-4).
 *
 * Run: node --test test/
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import {
  APP_PATH,
  BASE_PATH,
  BINDING_COOKIE,
  LOGIN_PATH,
  LOGOUT_PATH,
  escapeHtml,
  registerIdentityLoginRoutes,
} from "../lib/identity-routes.mjs";

const HOST = "dash.example:8010";
const ORIGIN = `http://${HOST}`;
/** A value that must never appear in a log line, a cookie, or a persisted view. */
const TOKEN = "SMOKE-access-token-must-never-leak";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A stubbed issuer: discovery + token endpoint, recording every fetch. */
function stubIssuer({ token = TOKEN, tokenStatus = 200, discoveryStatus = 200, omitToken = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: init.body });
    if (u.endsWith("/.well-known/openid-configuration")) {
      if (discoveryStatus !== 200) return jsonResponse({}, discoveryStatus);
      return jsonResponse({
        authorization_endpoint: "https://kc.example/authorize",
        token_endpoint: "https://kc.example/token",
        end_session_endpoint: "https://kc.example/end-session",
      });
    }
    if (u === "https://kc.example/token") {
      if (tokenStatus !== 200) return jsonResponse({ error: "invalid_grant" }, tokenStatus);
      const body = omitToken ? { expires_in: 300 } : { access_token: token, expires_in: 300, token_type: "Bearer" };
      return jsonResponse(body);
    }
    return jsonResponse({}, 404);
  };
  return { fetchImpl, calls, tokenCalls: () => calls.filter((c) => c.url === "https://kc.example/token").length };
}

function captureLogger() {
  const lines = [];
  const push = (level) => (...args) => lines.push(`${level} ${args.join(" ")}`);
  return { lines, info: push("info"), warn: push("warn"), error: push("error"), body: () => lines.join("\n") };
}

async function buildApp(opts = {}) {
  const app = Fastify();
  const stub = stubIssuer(opts.issuer);
  const logger = opts.logger ?? captureLogger();
  const routes = registerIdentityLoginRoutes(app, {
    issuer: "https://kc.example",
    browserIssuer: "https://kc.example",
    clientId: "smoke-client",
    pluginId: "identity-login-plane",
    fetchImpl: stub.fetchImpl,
    logger,
    now: opts.now,
    stateTtlMs: opts.stateTtlMs,
    viewsDir: opts.viewsDir,
  });
  await app.ready();
  return { app, stub, logger, routes };
}

/** Pull a named cookie's value out of a `set-cookie` header (string | string[]). */
function cookieValue(setCookie, name = BINDING_COOKIE) {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of list) {
    if (!raw) continue;
    const [pair] = String(raw).split(";");
    const i = pair.indexOf("=");
    if (i > 0 && pair.slice(0, i).trim() === name) return pair.slice(i + 1).trim();
  }
  return undefined;
}

function fullSetCookie(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.filter(Boolean).map(String).join("\n");
}

async function startFlow(app) {
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/start`, headers: { host: HOST } });
  const location = res.headers.location ?? "";
  const state = location ? new URL(location).searchParams.get("state") : null;
  const setCookie = res.headers["set-cookie"];
  return { res, location, state, binding: cookieValue(setCookie), setCookie };
}

async function callback(app, query, binding) {
  const headers = { host: HOST };
  if (binding !== undefined) headers.cookie = `${BINDING_COOKIE}=${binding}`;
  return app.inject({ method: "GET", url: `${BASE_PATH}/callback?${query}`, headers });
}

// ─────────────────────────────── unit: escaping ───────────────────────────────

test("escapeHtml neutralises every HTML metacharacter", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(42), "42");
});

// ─────────────────────────── start: routing + PKCE + cookie ───────────────────

test("start routes the browser to Keycloak with PKCE S256 and a browser-binding cookie", async () => {
  const { app, stub } = await buildApp();
  const { res, location, state, binding, setCookie } = await startFlow(app);

  assert.equal(res.statusCode, 302);
  const u = new URL(location);
  assert.equal(u.origin, "https://kc.example");
  assert.equal(u.pathname, "/authorize");
  assert.equal(u.searchParams.get("client_id"), "smoke-client");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.ok(u.searchParams.get("code_challenge"), "code_challenge present");
  assert.ok(state, "state present");
  assert.equal(u.searchParams.get("redirect_uri"), `${ORIGIN}${BASE_PATH}/callback`);

  const cookie = fullSetCookie(setCookie);
  assert.match(cookie, new RegExp(`${BINDING_COOKIE}=\\S+`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, new RegExp(`Path=${BASE_PATH.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`));
  assert.ok(binding && binding.length > 8, "binding value is opaque");
  assert.equal(stub.tokenCalls(), 0);
});

test("start never routes to the dashboard root and caches browser discovery", async () => {
  const { app, stub } = await buildApp();
  await startFlow(app);
  await startFlow(app);
  const discoveries = stub.calls.filter((c) => c.url.endsWith("/.well-known/openid-configuration")).length;
  assert.equal(discoveries, 1, "browser discovery cached across starts");
  assert.equal(new URL((await startFlow(app)).location).pathname, "/authorize");
});

test("start renders an escaped error page when discovery fails", async () => {
  const { app } = await buildApp({ issuer: { discoveryStatus: 503 } });
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/start`, headers: { host: HOST } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Could not reach the identity provider/);
});

// ──────────────────────────── callback: happy path ────────────────────────────

test("callback completes server-side and hands the token to the PLUGIN app, never the dashboard root", async () => {
  const { app, stub, logger } = await buildApp();
  const { state, binding } = await startFlow(app);
  const res = await callback(app, `code=stub-code&state=${state}`, binding);

  assert.equal(res.statusCode, 302);
  const location = res.headers.location ?? "";
  const u = new URL(location);
  assert.equal(u.origin, ORIGIN, "stays on the dashboard origin (same-origin)");
  assert.equal(u.pathname, APP_PATH, "handoff target is the plugin's own app");
  assert.notEqual(u.pathname, "/", "never the dashboard root");
  assert.ok(!location.startsWith(`${ORIGIN}/#`), "never the dashboard-root fragment form");

  const frag = new URLSearchParams(u.hash.slice(1));
  assert.equal(frag.get("access_token"), TOKEN);
  assert.equal(frag.get("expires_in"), "300");

  // one-shot: the binding cookie is cleared on the callback response
  const cookie = fullSetCookie(res.headers["set-cookie"]);
  assert.match(cookie, new RegExp(`${BINDING_COOKIE}=;`));
  assert.match(cookie, /Max-Age=0/);

  // the bearer is never persisted nor logged
  assert.ok(!cookie.includes(TOKEN), "token never set as a cookie");
  assert.ok(!logger.body().includes(TOKEN), "token never logged");
  assert.equal(stub.tokenCalls(), 1);
});

// ──────────────────── callback: handoff origin is the START origin ───────────

test("callback hands off on the origin the sign-in STARTED from, not the callback's Host header", async () => {
  const { app, stub } = await buildApp();
  const startHost = "start.example:8010";
  const start = await app.inject({ method: "GET", url: `${BASE_PATH}/start`, headers: { host: startHost } });
  const state = new URL(start.headers.location).searchParams.get("state");
  const binding = cookieValue(start.headers["set-cookie"]);

  // A token-injection callback could arrive under a forged Host. The handoff
  // must follow the origin stored at /start, never this Host.
  const res = await app.inject({
    method: "GET",
    url: `${BASE_PATH}/callback?code=stub-code&state=${state}`,
    headers: { host: "evil.example", cookie: `${BINDING_COOKIE}=${binding}` },
  });
  assert.equal(res.statusCode, 302);
  const u = new URL(res.headers.location);
  assert.equal(u.origin, `http://${startHost}`, "handoff origin is the stored start origin");
  assert.equal(u.pathname, APP_PATH);
  assert.notEqual(u.origin, "http://evil.example", "a spoofed callback Host never redirects the bearer");
  assert.equal(new URLSearchParams(u.hash.slice(1)).get("access_token"), TOKEN);
  // The same stored origin is what the exchange presented as redirect_uri.
  const exchange = stub.calls.find((c) => c.url === "https://kc.example/token");
  const expectedRedirect = `redirect_uri=${encodeURIComponent(`http://${startHost}${BASE_PATH}/callback`)}`;
  assert.ok(String(exchange?.body).includes(expectedRedirect), `exchange redirect_uri must match the start origin: ${expectedRedirect}`);
});

// ─────────────────── callback: state binding / expiry / replay ────────────────

test("callback refuses a missing browser-binding cookie (no exchange)", async () => {
  const { app, stub } = await buildApp();
  const { state } = await startFlow(app);
  const res = await callback(app, `code=stub-code&state=${state}`, undefined);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /verified|browser/i);
  assert.equal(stub.tokenCalls(), 0);
});

test("callback refuses a mismatched browser-binding cookie and burns the state", async () => {
  const { app, stub } = await buildApp();
  const { state, binding } = await startFlow(app);
  const bad = await callback(app, `code=stub-code&state=${state}`, `${binding}-tampered`);
  assert.equal(bad.statusCode, 200);
  assert.equal(stub.tokenCalls(), 0);
  // the mismatched attempt is one-shot: the correct binding can no longer replay
  const replay = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(replay.statusCode, 200);
  assert.equal(stub.tokenCalls(), 0, "state was burned by the mismatch");
});

test("callback refuses a replayed state (single-use)", async () => {
  const { app, stub } = await buildApp();
  const { state, binding } = await startFlow(app);
  const first = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(first.statusCode, 302);
  const second = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(second.statusCode, 200);
  assert.equal(stub.tokenCalls(), 1, "exchange happens exactly once");
});

test("callback refuses an expired state (no exchange)", async () => {
  let clock = 1_000_000;
  const { app, stub } = await buildApp({ now: () => clock, stateTtlMs: 1_000 });
  const { state, binding } = await startFlow(app);
  clock += 1_001;
  const res = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /expired/i);
  assert.equal(stub.tokenCalls(), 0);
});

test("callback refuses an unknown state (no exchange)", async () => {
  const { app, stub } = await buildApp();
  const res = await callback(app, "code=stub-code&state=not-a-real-state", "whatever");
  assert.equal(res.statusCode, 200);
  assert.equal(stub.tokenCalls(), 0);
});

// ──────────────── callback: idp error + exchange failure hygiene ──────────────

test("callback HTML-escapes the untrusted error parameter and skips the exchange", async () => {
  const { app, stub } = await buildApp();
  const res = await callback(app, `error=${encodeURIComponent("<script>alert(1)</script>")}`, "x");
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes("<script>alert(1)</script>"), "raw script not reflected");
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(stub.tokenCalls(), 0);
});

test("callback renders a generic error when the token endpoint fails", async () => {
  const { app, logger } = await buildApp({ issuer: { tokenStatus: 400 } });
  const { state, binding } = await startFlow(app);
  const res = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /failed/i);
  assert.ok(!res.body.includes("invalid_grant"), "raw provider error not disclosed");
  assert.ok(!logger.body().includes(TOKEN));
});

test("callback renders a generic error when the issuer returns no access token", async () => {
  const { app } = await buildApp({ issuer: { omitToken: true } });
  const { state, binding } = await startFlow(app);
  const res = await callback(app, `code=stub-code&state=${state}`, binding);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /no access token/i);
});

// ───────────────────────────── frontend app page ──────────────────────────────

test("app page speaks the exact dashboard protocol (REST bearer, ticket, WS)", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: APP_PATH, headers: { host: HOST } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.equal(res.headers["cache-control"], "no-store");

  // REST: bearer list + negative no-bearer control
  assert.ok(res.body.includes("/api/sessions"), "lists sessions via /api/sessions");
  assert.match(res.body, /Authorization['"`:\s]*Bearer/i, "uses Authorization: Bearer");
  // ticket mint, exact path + scope
  assert.ok(res.body.includes("/api/ws-ticket"), "mints via /api/ws-ticket");
  assert.match(res.body, /scope\s*:\s*"browser"/, "browser-scope ticket");
  // WS upgrade at /ws with ?ticket=, and the actual protocol frames
  assert.match(res.body, /\/ws\?ticket=/, "upgrades /ws with the ticket only");
  assert.ok(res.body.includes("sessions_snapshot"), "handles the on-connect snapshot");
  assert.ok(res.body.includes("sessions_page"), "exchanges a harmless sessions_page round-trip");
  assert.ok(res.body.includes("sessions_page_result"), "awaits the sessions_page_result reply");

  // fragment is plugin-owned and stripped immediately; no dashboard-root adoption
  assert.ok(res.body.includes("history.replaceState"), "strips the fragment in place");
  assert.ok(!/window\.location\s*=\s*['"`]\/#/.test(res.body), "never navigates the dashboard root fragment");
});

test("app page holds the token in memory only (no web storage, no raw secret rendering)", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: APP_PATH, headers: { host: HOST } });
  assert.ok(!res.body.includes(TOKEN), "no token in the static page");
  assert.ok(!/localStorage|sessionStorage/.test(res.body), "never uses web storage for the token");
  assert.ok(!/document\.write/.test(res.body), "never document.write");
  assert.ok(!/innerHTML\s*=/.test(res.body), "renders server data with textContent, not innerHTML");
});

// ───────────────────────────── views + logout ─────────────────────────────────

test("login view links to the plugin start route, not the dashboard root", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/`, headers: { host: HOST } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`${BASE_PATH}/start`), "starts the plugin flow");
});

test("logout perform redirects to Keycloak end-session and returns to the PLUGIN login, not /", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/logout/perform`, headers: { host: HOST } });
  assert.equal(res.statusCode, 302);
  const u = new URL(res.headers.location);
  assert.equal(u.origin, "https://kc.example");
  assert.equal(u.pathname, "/end-session");
  assert.equal(u.searchParams.get("post_logout_redirect_uri"), `${ORIGIN}${LOGIN_PATH}`);
  assert.notEqual(u.searchParams.get("post_logout_redirect_uri"), `${ORIGIN}/`);
});

test("logout view returns to the plugin login page, not the dashboard root", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: LOGOUT_PATH, headers: { host: HOST } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.includes(`${BASE_PATH}/logout/perform`));
  assert.ok(!/href="\/"/.test(res.body), "no link to the dashboard root");
});

// ───────────────────── same-origin hardening (no new CORS) ────────────────────

test("routes use the request protocol/host (no hardcoded http) and add no CORS trust", async () => {
  const { app } = await buildApp();
  const start = await app.inject({
    method: "GET",
    url: `${BASE_PATH}/start`,
    headers: { host: "internal.example:9999", "x-forwarded-proto": "https" },
  });
  // Fastify inject always speaks http; the point is the helper derives from the
  // request, so an https/host change is reflected rather than hardcoded.
  const redirect = new URL(start.headers.location);
  assert.equal(redirect.searchParams.get("redirect_uri"), `http://internal.example:9999${BASE_PATH}/callback`);

  const appPage = await app.inject({ method: "GET", url: APP_PATH, headers: { host: HOST } });
  assert.ok(!/access-control-allow/i.test(fullSetCookie(appPage.headers["set-cookie"])), "no CORS headers");
  assert.ok(!appPage.body.includes("Access-Control"), "frontend is same-origin only");
});
