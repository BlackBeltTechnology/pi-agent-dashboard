/**
 * identity-login-plane · route factory (D20 independent-frontend smoke).
 *
 * SERVER-side half of the disposable smoke. The plugin owns login, callback and
 * logout and serves its own pages from the shared Fastify instance (same-origin,
 * outside the network guard's `/api /v1 /editor /live` jurisdiction, so they are
 * reachable pre-auth).
 *
 *   GET /identity-login/                → its own sign-in page ("Sign in with Keycloak")
 *   GET /identity-login/start           → 302 to Keycloak authorize (PKCE S256) + browser-binding cookie
 *   GET /identity-login/callback        → verify state + binding, exchange the code SERVER-SIDE
 *   GET /identity-login/app             → the plugin's OWN frontend (holds the token in JS memory)
 *   GET /identity-login/logout          → its own sign-out page
 *   GET /identity-login/logout/perform  → RP-initiated logout at Keycloak, back to the plugin login
 *
 * D20 TOKEN HANDOFF (in-spike convention, NOT core spec): the callback redirects
 * to the PLUGIN's own app with the bearer in the URL fragment
 * (`/identity-login/app#access_token=…`). A fragment never reaches a server and
 * the app page strips it immediately (`history.replaceState`) into an in-memory
 * variable. It is NEVER the dashboard root (`/#access_token=…`) and core adopts
 * nothing — the dashboard is a backend resource server only.
 *
 * BROWSER BINDING: `/start` sets a short-lived `HttpOnly; SameSite=Lax` cookie
 * carrying a random binding nonce tied to the PKCE `state`. `/callback` requires
 * the SAME browser to present it (constant-time compare) and clears it. This
 * defeats a login-CSRF / code-injection callback by any other browser, and the
 * state entry is deleted on first use (one-shot, replay-proof).
 *
 * HANDOFF ORIGIN: the callback redirects to the origin captured on the STORED
 * `redirectUri` at `/start` — never the callback request's own `Host`, which is
 * attacker-influenceable (a spoofed Host would bounce the in-fragment bearer to
 * a foreign origin). The `redirect_uri` used at the token exchange is that same
 * stored value, so authorize + exchange + handoff all agree.
 *
 * Exported as a factory so `node:test` can drive every route through
 * `app.inject()` with a stubbed issuer — no network, no Keycloak, no browser.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const BASE_PATH = "/identity-login";
export const APP_PATH = `${BASE_PATH}/app`;
export const LOGIN_PATH = `${BASE_PATH}/`;
export const LOGOUT_PATH = `${BASE_PATH}/logout`;
export const BINDING_COOKIE = "pi_login_bind";
/** Cookie Path: a prefix match for every route below `/identity-login`. */
export const BINDING_COOKIE_PATH = BASE_PATH;
export const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000;
/** D22 dashboard-UI mode. */
export const START_PATH = `${BASE_PATH}/start`;
export const TOKEN_PATH = `${BASE_PATH}/token`;
export const SIGNOUT_PATH = `${BASE_PATH}/signout`;
/** A compact JWS (three base64url segments) — anything else is not forwarded. */
const ID_TOKEN_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
/** OIDC errors meaning "no usable IdP session" on a prompt=none attempt. */
const SILENT_MISS = new Set(["login_required", "interaction_required", "consent_required", "account_selection_required"]);
export const SIGNED_OUT_URL = "/login?pi_signed_out=1";
/** A handoff code lives at most this long (D22: ≤60 s). */
export const HANDOFF_TTL_MS = 60 * 1000;

/** Same-origin path or "/" — the open-redirect boundary for `returnTo`. */
export function safeReturnPath(raw) {
  const s = typeof raw === "string" ? raw : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return "/";
  // Control characters (CR/LF/tab/NUL…) never reach a Location header.
  if (/[\u0000-\u001f\u007f]/.test(s)) return "/";
  return s;
}

/** Escape every HTML metacharacter before a value reaches a view. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const stripSlash = (v) => String(v ?? "").replace(/\/+$/, "");

/** Serialize the browser-binding cookie. `maxAgeSeconds: 0` clears it. */
function serializeBindingCookie(value, maxAgeSeconds) {
  return [
    `${BINDING_COOKIE}=${value ?? ""}`,
    `Path=${BINDING_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

/** First value of `name` in a Cookie header, or null. */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Constant-time string equality (length is not secret enough to need hiding). */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Register the plugin's routes on `fastify`.
 *
 * @param {import("fastify").FastifyInstance} fastify
 * @param {object} opts
 * @param {string} opts.issuer          server-side discovery + token exchange base
 * @param {string} [opts.browserIssuer] browser-reachable authorize base (defaults to issuer)
 * @param {string} opts.clientId        public PKCE client id
 * @param {string} [opts.pluginId]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {{info:Function,warn:Function,error:Function}} [opts.logger]
 * @param {() => number} [opts.now]
 * @param {number} [opts.stateTtlMs]
 * @param {string} [opts.viewsDir]
 * @returns {{ pending: Map<string, object> }}
 */
export function registerIdentityLoginRoutes(fastify, opts) {
  const issuer = stripSlash(opts.issuer);
  const browserIssuer = stripSlash(opts.browserIssuer ?? opts.issuer);
  const clientId = opts.clientId;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const logger = opts.logger ?? console;
  const now = opts.now ?? (() => Date.now());
  const stateTtlMs = opts.stateTtlMs ?? DEFAULT_STATE_TTL_MS;
  const viewsDir = opts.viewsDir ?? join(HERE, "..", "views");
  const pending = opts.pending ?? new Map();
  /** D22 one-time handoff codes → { accessToken, expiresIn, challenge, expiresAt }. */
  const handoffs = new Map();

  /** Cached browser-facing discovery document — the authorize base is stable. */
  let browserDisc = null;

  // The redirect base must follow the REQUEST (scheme + host), never a
  // hardcoded `http://`. `request.protocol` respects Fastify's trustProxy.
  const originOf = (req) => `${req.protocol}://${req.headers.host}`;
  const callbackUrlFor = (req) => `${originOf(req)}${BASE_PATH}/callback`;

  const dropExpired = () => {
    const t = now();
    for (const [k, v] of pending) if (v.expiresAt < t) pending.delete(k);
  };

  async function discover(base) {
    const res = await fetchImpl(`${base}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
    return res.json();
  }

  async function sendView(reply, file, vars = {}) {
    let html = await readFile(join(viewsDir, file), "utf-8");
    for (const [k, v] of Object.entries(vars)) html = html.replaceAll(`{{${k}}}`, escapeHtml(v));
    return reply.type("text/html; charset=utf-8").send(html);
  }

  fastify.get(LOGIN_PATH, async (_req, reply) =>
    sendView(reply, "login.html", { ISSUER: browserIssuer, CLIENT_ID: clientId }),
  );

  // Start: mint PKCE + state + browser-binding, stash server-side, set the
  // one-shot binding cookie, send the browser to Keycloak.
  fastify.get(START_PATH, async (req, reply) => {
    // D22 dashboard-UI mode: the SPA sent its own S256 challenge. No page, no
    // cookie — straight to the IdP, and errors go back to the dashboard.
    const spaChallenge = typeof req.query?.challenge === "string" ? req.query.challenge : "";
    const returnTo = safeReturnPath(req.query?.returnTo);
    // Silent sign-in: only the exact value `none` is forwarded (OIDC prompt=none).
    const silent = spaChallenge !== "" && req.query?.prompt === "none";
    try {
      browserDisc = browserDisc ?? (await discover(browserIssuer));
    } catch (err) {
      logger.error(`[identity-login-plane] browser-issuer discovery failed: ${err?.message ?? err}`);
      if (spaChallenge) return reply.redirect(`${originOf(req)}${returnTo}#pi_login_error=idp_unreachable`);
      return sendView(reply, "error.html", { MESSAGE: "Could not reach the identity provider." });
    }
    const disc = browserDisc;
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(16));
    const binding = b64url(randomBytes(16));
    pending.set(state, {
      verifier,
      redirectUri: callbackUrlFor(req),
      expiresAt: now() + stateTtlMs,
      ...(spaChallenge ? { mode: "handoff", spaChallenge, returnTo } : { binding }),
    });
    dropExpired();

    const url = new URL(disc.authorization_endpoint);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid");
    url.searchParams.set("redirect_uri", pending.get(state).redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (silent) url.searchParams.set("prompt", "none");
    if (!spaChallenge) reply.header("Set-Cookie", serializeBindingCookie(binding, Math.floor(stateTtlMs / 1000)));
    logger.info(`[identity-login-plane] routing to Keycloak (state ${state.slice(0, 8)}…)`);
    return reply.redirect(url.toString());
  });

  // Callback: bound-to-browser, one-shot, then the server-side code exchange.
  fastify.get(`${BASE_PATH}/callback`, async (req, reply) => {
    const clearBinding = () => reply.header("Set-Cookie", serializeBindingCookie("", 0));
    const fail = (message) => {
      clearBinding();
      return sendView(reply, "error.html", { MESSAGE: message });
    };

    const { code, state, error } = req.query ?? {};
    // An IdP error response (RFC 6749 §4.1.2.1) is attacker-influenceable text:
    // escape it and never reflect the provider verbatim.
    if (error) {
      const started = state ? pending.get(state) : undefined;
      if (state && pending.has(state)) pending.delete(state);
      // Handoff mode: back to the dashboard. No IdP session on a silent attempt
      // ⇒ `login_required` (the dashboard then shows its login page); anything
      // else ⇒ a fixed `denied` literal, never the provider's text.
      if (started?.mode === "handoff") {
        const reason = SILENT_MISS.has(String(error)) ? "login_required" : "denied";
        return reply.redirect(`${new URL(started.redirectUri).origin}${started.returnTo}#pi_login_error=${reason}`);
      }
      // The code is attacker-influenceable (URL): bound it and let sendView
      // escape it. Never reflect `error_description`.
      const code = String(error).slice(0, 64);
      return fail(`The identity provider refused the sign-in (${code}). Please try again.`);
    }

    const entry = state ? pending.get(state) : undefined;
    if (entry?.mode === "handoff") {
      pending.delete(state);
      return completeHandoffCallback(reply, entry, code);
    }
    if (!entry || !code) {
      return fail("Sign-in state was missing or expired — please start again.");
    }

    // Browser binding: the SAME browser that called /start must present the
    // cookie. On mismatch, burn the state (one-shot) so neither the attacker nor
    // a later replay can complete the exchange.
    const presented = readCookie(req.headers.cookie, BINDING_COOKIE);
    if (!safeEqual(presented, entry.binding)) {
      pending.delete(state);
      return fail("Sign-in could not be verified for this browser — please start again.");
    }

    // Single-use: consume the state before the exchange, whatever happens next.
    pending.delete(state);
    if (entry.expiresAt < now()) {
      return fail("Sign-in state expired — please start again.");
    }

    let body;
    try {
      const tokenEndpoint = (await discover(issuer)).token_endpoint;
      const res = await fetchImpl(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          redirect_uri: entry.redirectUri,
          code_verifier: entry.verifier,
        }).toString(),
      });
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      body = await res.json();
    } catch (err) {
      logger.error(`[identity-login-plane] exchange failed: ${err?.message ?? err}`);
      return fail("Token exchange with the identity provider failed.");
    }
    if (!body.access_token) {
      return fail("The identity provider returned no access token.");
    }

    // Hand off to the PLUGIN'S OWN frontend (never the dashboard root). Fragment
    // never reaches a server; the app strips it immediately into JS memory.
    const frag = new URLSearchParams({
      access_token: body.access_token,
      expires_in: String(body.expires_in ?? 0),
      ...(body.token_type ? { token_type: body.token_type } : {}),
    });
    // Hand off to the PLUGIN'S OWN frontend on the origin the browser STARTED
    // from (the stored redirectUri), NEVER the current request's Host — Host is
    // attacker-influenceable, and a spoofed one would redirect the bearer in
    // the fragment to a foreign origin. `entry` survives the `pending.delete`
    // above; only the map entry was removed.
    const handoffOrigin = new URL(entry.redirectUri).origin;
    clearBinding();
    logger.info(`[identity-login-plane] sign-in complete for a ${body.expires_in ?? "?"}s token; handing off to ${APP_PATH}`);
    return reply.redirect(`${handoffOrigin}${APP_PATH}#${frag.toString()}`);
  });

  /** Server-side IdP code exchange; returns the token body or throws. */
  async function exchangeIdpCode(code, entry) {
    const tokenEndpoint = (await discover(issuer)).token_endpoint;
    const res = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: entry.redirectUri,
        code_verifier: entry.verifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`token endpoint ${res.status}`);
    const body = await res.json();
    if (!body.access_token) throw new Error("no access token");
    return body;
  }

  // D22: finish a dashboard-UI sign-in. Back to `returnTo` on the STARTED
  // origin (stored redirectUri, never the callback Host) with a one-time code
  // bound to the SPA's challenge — the bearer itself never rides a URL.
  async function completeHandoffCallback(reply, entry, code) {
    const origin = new URL(entry.redirectUri).origin;
    const back = (frag) => reply.redirect(`${origin}${entry.returnTo}#${frag}`);
    if (!code || entry.expiresAt < now()) return back("pi_login_error=expired");
    let body;
    try {
      body = await exchangeIdpCode(code, entry);
    } catch (err) {
      logger.error(`[identity-login-plane] exchange failed: ${err?.message ?? err}`);
      return back("pi_login_error=exchange_failed");
    }
    const handoff = b64url(randomBytes(24));
    handoffs.set(handoff, {
      accessToken: body.access_token,
      ...(typeof body.id_token === "string" ? { idToken: body.id_token } : {}),
      expiresIn: Number(body.expires_in ?? 0),
      challenge: entry.spaChallenge,
      expiresAt: now() + HANDOFF_TTL_MS,
    });
    logger.info("[identity-login-plane] sign-in complete; one-time handoff issued to the dashboard");
    return back(`pi_handoff=${handoff}`);
  }

  // D22: redeem a handoff code. Single-use (deleted on ANY attempt), ≤60 s,
  // and only with the verifier whose S256 matches the challenge sent at /start.
  fastify.post(TOKEN_PATH, async (req, reply) => {
    const { code, verifier } = req.body ?? {};
    const entry = typeof code === "string" ? handoffs.get(code) : undefined;
    if (entry) handoffs.delete(code);
    const presented = typeof verifier === "string" ? createHash("sha256").update(verifier).digest("base64url") : "";
    if (!entry || entry.expiresAt < now() || !safeEqual(presented, entry.challenge)) {
      return reply.code(400).send({ error: "invalid_grant" });
    }
    return reply
      .header("Cache-Control", "no-store")
      .send({ access_token: entry.accessToken, expires_in: entry.expiresIn, ...(entry.idToken ? { id_token: entry.idToken } : {}) });
  });

  // D22: dashboard Sign out — RP-initiated logout, back to the dashboard's
  // signed-out landing (must be a registered post-logout URI at the IdP).
  fastify.get(SIGNOUT_PATH, async (req, reply) => {
    const landing = `${originOf(req)}${SIGNED_OUT_URL}`;
    try {
      const url = new URL((await discover(issuer)).end_session_endpoint);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("post_logout_redirect_uri", landing);
      // OIDC RP-initiated logout: with id_token_hint the IdP knows who is
      // leaving and skips its "Do you want to log out?" confirmation.
      const hint = req.query?.id_token_hint;
      if (typeof hint === "string" && ID_TOKEN_SHAPE.test(hint) && hint.length <= 8192) url.searchParams.set("id_token_hint", hint);
      return reply.redirect(url.toString());
    } catch (err) {
      logger.warn(`[identity-login-plane] logout discovery failed: ${err?.message ?? err}`);
      return reply.redirect(landing);
    }
  });

  // The plugin's own frontend document. Static; no token is present server-side.
  // Read once at registration: the handler never touches the filesystem.
  const appHtml = readFileSync(join(viewsDir, "app.html"), "utf-8");
  fastify.get(APP_PATH, async (_req, reply) => {
    const html = appHtml;
    return reply
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(html);
  });

  fastify.get(LOGOUT_PATH, async (_req, reply) => sendView(reply, "logout.html", { ISSUER: issuer }));

  fastify.get(`${BASE_PATH}/logout/perform`, async (req, reply) => {
    try {
      const disc = await discover(issuer);
      const url = new URL(disc.end_session_endpoint);
      url.searchParams.set("client_id", clientId);
      // Return to the PLUGIN'S login, not the dashboard root.
      url.searchParams.set("post_logout_redirect_uri", `${originOf(req)}${LOGIN_PATH}`);
      return reply.redirect(url.toString());
    } catch (err) {
      logger.warn(`[identity-login-plane] logout discovery failed: ${err?.message ?? err}`);
      return reply.redirect(`${originOf(req)}${LOGIN_PATH}`);
    }
  });

  return { pending };
}
