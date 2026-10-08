/**
 * identity-login-plane · SERVER entry (TEMPORARY smoke artifact, D19 + D20).
 *
 * The "login plane" as a SEPARATE VIEW: this plugin serves its own site and
 * ROUTES THE BROWSER TO KEYCLOAK. It claims no client slot and ships nothing
 * into the dashboard's client bundle.
 *
 * The route logic lives in `lib/identity-routes.mjs` (a factory, so `node:test`
 * can drive it through `app.inject()` with a stubbed issuer). This entry only
 * wires env config and publishes the descriptor to core.
 *
 *   GET /identity-login/                → its own sign-in page  ("Sign in with Keycloak")
 *   GET /identity-login/start           → 302 to Keycloak authorize (PKCE S256) + binding cookie
 *   GET /identity-login/callback        → verify state + binding, exchange the code SERVER-SIDE
 *   GET /identity-login/app             → its OWN frontend (token kept in JS memory)
 *   GET /identity-login/logout          → its own sign-out page
 *   GET /identity-login/logout/perform  → RP-initiated logout at Keycloak
 *   ctx.registerBrowserLoginConfig({ pluginId, loginUrl, logoutUrl })
 *
 * D20 TOKEN HANDOFF (in-spike convention, NOT core spec): the callback redirects
 * to the PLUGIN'S OWN `/identity-login/app#access_token=…`, never the dashboard
 * root. No core fragment-adoption path exists or is required — the dashboard is
 * a backend resource server; the app holds the bearer in memory and talks
 * HTTP/WS to it directly.
 *
 * BROWSER BINDING: `/start` sets a short-lived `HttpOnly; SameSite=Lax` cookie
 * (the browser-binding nonce); `/callback` requires the same browser to present
 * it and clears it. PKCE state is single-use and expiry-bounded.
 *
 * Core then reroutes: the auth-required banner links to `loginUrl`, and
 * `/logout` redirects to `logoutUrl`. Both paths sit outside the network guard's
 * jurisdiction (`/api/ /v1/ /editor/ /live/`), so they are reachable pre-auth.
 *
 * Configuration — NO defaults: the plugin offers sign-in ONLY when Keycloak is
 * configured (issuer + clientId); otherwise it registers nothing and logs why.
 * Plugin config (`plugins["identity-login-plane"]`: issuer, browserIssuer,
 * clientId) wins; env is the fallback (docker / e2e harnesses):
 *   PI_LOGIN_ISSUER          Keycloak realm issuer the SERVER uses for discovery +
 *                            the code exchange. Must match the resolver's pinned
 *                            `issuer`, because `iss` is set by the exchange host.
 *   PI_LOGIN_BROWSER_ISSUER  what the BROWSER is sent to for the authorize request.
 *                            Defaults to PI_LOGIN_ISSUER. Split them when the server
 *                            reaches Keycloak on an internal URL (docker: `keycloak:8080`)
 *                            while the browser needs a reachable one.
 *   PI_LOGIN_CLIENT_ID       public PKCE client id
 *
 * LAN NOTE: pointing the browser at `localhost` only works on the dashboard's own
 * machine. For a browser on another device BOTH issuers must be an address that
 * device can reach (e.g. `http://192.168.0.157:18080/realms/pi-identity`) — and
 * Keycloak's `iss` then follows that host, so the resolver must pin the same one.
 *
 * Server-side PKCE is used deliberately: no `crypto.subtle` (secure-context
 * only) and no browser dependency, so this works on plain-http origins too.
 */
import { resolveLoginPlaneConfig } from "./lib/config.mjs";
import { LOGIN_PATH, registerIdentityLoginRoutes, SIGNED_OUT_URL, SIGNOUT_PATH, START_PATH, TOKEN_PATH } from "./lib/identity-routes.mjs";

const PLUGIN_ID = "identity-login-plane";

export default async function registerPlugin(ctx) {
  const log = ctx.logger;
  const config = resolveLoginPlaneConfig(ctx.getPluginConfig?.(), process.env);
  if (!config.ok) {
    // Not configured ⇒ offer nothing: no routes, no login descriptor. Core
    // then stays inert (D21) and never shows a sign-in for an absent Keycloak.
    log.info(`[identity-login-plane] Keycloak not configured (missing ${config.missing.join(", ")}); sign-in NOT offered`);
    return;
  }
  const ISSUER = config.issuer;

  registerIdentityLoginRoutes(ctx.fastify, {
    issuer: ISSUER,
    browserIssuer: config.browserIssuer,
    clientId: config.clientId,
    pluginId: PLUGIN_ID,
    logger: log,
  });

  if (typeof ctx.registerBrowserLoginConfig !== "function") {
    log.warn("[identity-login-plane] host exposes no registerBrowserLoginConfig; pages served but core will not route here");
    return;
  }
  // The host stamps the owning `pluginId` itself (D16/F6); passing it here is
  // documentation of intent and is dropped by the host sanitizer.
  // D22 dashboard-UI mode: the SPA's sign-in dialog goes straight to START_PATH
  // (→ IdP) and redeems the handoff at TOKEN_PATH. The plugin's own pages
  // (LOGIN_PATH / LOGOUT_PATH, topology A, D20) stay reachable directly.
  ctx.registerBrowserLoginConfig({
    pluginId: PLUGIN_ID,
    loginUrl: START_PATH,
    logoutUrl: SIGNOUT_PATH,
    tokenUrl: TOKEN_PATH,
    postLogoutUrl: SIGNED_OUT_URL,
    label: "Keycloak",
    endsProviderSession: true,
    // Supports OIDC prompt=none at loginUrl: a live IdP session signs the
    // dashboard in with no click; no session ⇒ #pi_login_error=login_required.
    silentSignIn: true,
  });
  log.info(`[identity-login-plane] login plane offered (${START_PATH} → ${ISSUER})`);
}
