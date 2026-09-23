/**
 * node:test — security abuse cases for the login plugin's dashboard-UI
 * (handoff) mode. Each test is an attacker move; the assertion is that it
 * gains nothing and never crashes the route.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import { BASE_PATH, registerIdentityLoginRoutes, safeReturnPath } from "../lib/identity-routes.mjs";

const HOST = "dash.example:8010";
const ORIGIN = `http://${HOST}`;
const VERIFIER = "spa-verifier-0123456789abcdefghijklmnopqrstuvwxyz";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function buildApp() {
  const app = Fastify();
  const lines = [];
  const log = (lvl) => (...a) => lines.push(`${lvl} ${a.join(" ")}`);
  registerIdentityLoginRoutes(app, {
    issuer: "https://kc.example",
    clientId: "dashboard-web",
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.endsWith("/.well-known/openid-configuration")) {
        return json({ authorization_endpoint: "https://kc.example/authorize", token_endpoint: "https://kc.example/token", end_session_endpoint: "https://kc.example/end" });
      }
      if (u === "https://kc.example/token") return json({ access_token: "AT", id_token: "h.p.s", expires_in: 300 });
      return json({}, 404);
    },
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
  });
  await app.ready();
  return { app, lines };
}

async function handoffFor(app, returnTo = "/", headers = {}) {
  const s = await app.inject({ method: "GET", url: `${BASE_PATH}/start?returnTo=${encodeURIComponent(returnTo)}&challenge=${CHALLENGE}`, headers: { host: HOST, ...headers } });
  const state = new URL(s.headers.location).searchParams.get("state");
  const cb = await app.inject({ method: "GET", url: `${BASE_PATH}/callback?code=idp-code&state=${state}`, headers: { host: HOST } });
  return { s, cb };
}
const redeem = (app, payload, extra = {}) =>
  app.inject({ method: "POST", url: `${BASE_PATH}/token`, headers: { host: HOST, "content-type": "application/json", ...extra }, payload });

// ── Open redirect / header injection through returnTo ───────────────────────
test("returnTo with control characters (CR/LF/tab/NUL) collapses to / — no header injection", async () => {
  const { app } = await buildApp();
  for (const rt of ["/x\r\nSet-Cookie: pwn=1", "/x\nLocation: https://evil.example", "/\t/evil.example", "/x\u0000y"]) {
    assert.equal(safeReturnPath(rt), "/", JSON.stringify(rt));
    const { cb } = await handoffFor(app, rt);
    assert.equal(cb.statusCode, 302, JSON.stringify(rt));
    const loc = new URL(cb.headers.location);
    assert.equal(loc.origin, ORIGIN);
    assert.equal(loc.pathname, "/");
    assert.equal(cb.headers["set-cookie"], undefined);
  }
});

test("returnTo can never point off the dashboard origin", async () => {
  const { app } = await buildApp();
  for (const rt of ["https://evil.example/", "//evil.example", "/\\evil.example", "javascript:alert(1)", "evil.example"]) {
    const { cb } = await handoffFor(app, rt);
    assert.equal(new URL(cb.headers.location).origin, ORIGIN, rt);
  }
});

test("X-Forwarded-Host is NOT trusted for the callback / handoff origin", async () => {
  const { app } = await buildApp();
  const { s, cb } = await handoffFor(app, "/", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" });
  assert.ok(new URL(s.headers.location).searchParams.get("redirect_uri").startsWith(`${ORIGIN}/`));
  assert.equal(new URL(cb.headers.location).origin, ORIGIN);
});

// ── Handoff code: unguessable, single-use, bound, not cacheable ──────────────
test("handoff codes are high-entropy and unique", async () => {
  const { app } = await buildApp();
  const codes = new Set();
  for (let i = 0; i < 25; i++) {
    const { cb } = await handoffFor(app);
    const code = new URLSearchParams(new URL(cb.headers.location).hash.slice(1)).get("pi_handoff");
    assert.match(code, /^[\w-]{32,}$/);
    codes.add(code);
  }
  assert.equal(codes.size, 25);
});

test("brute-forcing codes gets only invalid_grant (no oracle, no crash)", async () => {
  const { app } = await buildApp();
  await handoffFor(app); // a real code exists
  for (let i = 0; i < 200; i++) {
    const res = await redeem(app, { code: randomBytes(24).toString("base64url"), verifier: VERIFIER });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "invalid_grant" });
  }
});

test("a stolen code is useless without the browser's verifier, and the attempt burns it", async () => {
  const { app } = await buildApp();
  const { cb } = await handoffFor(app);
  const code = new URLSearchParams(new URL(cb.headers.location).hash.slice(1)).get("pi_handoff");
  assert.equal((await redeem(app, { code, verifier: "attacker-guess-verifier-xxxxxxxxxxxxxxxxxxxxxxxx" })).statusCode, 400);
  assert.equal((await redeem(app, { code, verifier: VERIFIER })).statusCode, 400, "burned by the failed attempt");
});

test("malformed /token bodies are refused cleanly (400, never 500)", async () => {
  const { app } = await buildApp();
  const bodies = [
    {},
    { code: ["a"], verifier: VERIFIER },
    { code: { $ne: null }, verifier: VERIFIER },
    { code: "x", verifier: 123 },
    { code: "x", verifier: "v".repeat(100_000) },
    [],
    "null",
  ];
  for (const b of bodies) {
    const res = await redeem(app, b);
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, `${JSON.stringify(b).slice(0, 40)} → ${res.statusCode}`);
  }
});

test("the token response is never cacheable and sets no cookie", async () => {
  const { app } = await buildApp();
  const { cb } = await handoffFor(app);
  const code = new URLSearchParams(new URL(cb.headers.location).hash.slice(1)).get("pi_handoff");
  const res = await redeem(app, { code, verifier: VERIFIER });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["set-cookie"], undefined);
});

test("GET on the token endpoint does not redeem anything", async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: "GET", url: `${BASE_PATH}/token?code=x&verifier=${VERIFIER}`, headers: { host: HOST } });
  assert.ok(res.statusCode === 404 || res.statusCode === 405, String(res.statusCode));
});

// ── Secrets never logged ─────────────────────────────────────────────────────
test("neither the access token, the id_token, the verifier nor the handoff code is logged", async () => {
  const { app, lines } = await buildApp();
  const { cb } = await handoffFor(app);
  const code = new URLSearchParams(new URL(cb.headers.location).hash.slice(1)).get("pi_handoff");
  await redeem(app, { code, verifier: VERIFIER });
  await app.inject({ method: "GET", url: `${BASE_PATH}/signout?id_token_hint=h.p.s`, headers: { host: HOST } });
  const all = lines.join("\n");
  for (const secret of ["h.p.s", VERIFIER, code]) assert.ok(!all.includes(secret), `leaked ${secret.slice(0, 8)}…`);
  assert.doesNotMatch(all, /\bAT\b/, "leaked the access token");
});

// ── Silent sign-in cannot be turned into a forced interactive prompt ─────────
test("only prompt=none is forwarded (no prompt=login / consent / select_account injection)", async () => {
  const { app } = await buildApp();
  for (const p of ["login", "consent", "select_account", "none login", "NONE"]) {
    const res = await app.inject({ method: "GET", url: `${BASE_PATH}/start?returnTo=%2F&challenge=${CHALLENGE}&prompt=${encodeURIComponent(p)}`, headers: { host: HOST } });
    assert.equal(new URL(res.headers.location).searchParams.get("prompt"), null, p);
  }
});
