/**
 * Browser OIDC login mechanics for the Keycloak resolver (D16, LG-8/10/13/14).
 *
 * Pure of React so it unit-tests without jsdom. Reuses core's shared identity
 * primitives (`oidc-flow`, `token-store`) from client-utils — the SAME module
 * singleton core's fetch wrapper reads, so a token written here is visible to
 * every subsequent `/api` request without any handoff.
 *
 * `start` half: fetch the generic login descriptor → OIDC-discover the browser
 * issuer → build a PKCE-S256 authorize request → persist {verifier,state,
 * returnTo,+endpoints} → redirect. `callback` half: verify `state`, exchange
 * the code, store the (plain bearer) token, and report the recovered return-to.
 *
 * Core owns return-to VALIDATION (open-redirect defence) and the post-callback
 * navigation; this module only persists the value core handed it and relays it
 * back via the callback result. DPoP-bound login is a documented non-goal
 * (B4/LG-19): a plain bearer is stored, no key is persisted across the redirect.
 */

import {
  buildAuthorizeRequest,
  exchangeCode,
  type OidcClientConfig,
} from "@blackbelt-technology/pi-dashboard-client-utils/identity/oidc-flow";
import { setAccessToken } from "@blackbelt-technology/pi-dashboard-client-utils/identity/token-store";

/** sessionStorage key holding the transient PKCE state across the redirect. */
export const STASH_KEY = "keycloak-resolver:login";
/** Core-owned pre-token route the authorize request redirects back to. */
export const CALLBACK_PATH = "/callback";

interface LoginConfig {
  active: boolean;
  issuer?: string;
  clientId?: string;
}

interface Stash {
  verifier: string;
  state: string;
  returnTo: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
}

/** OIDC discovery document fields this flow consumes. */
interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Start phase: discover, build the PKCE authorize request, persist the
 * transient state, and redirect the browser. Throws when login is not
 * configured (the caller renders the failure state).
 */
export async function beginLogin(returnTo: string): Promise<void> {
  const cfg = await fetchJson<LoginConfig>("/api/identity/login-config");
  if (!cfg.active || !cfg.issuer || !cfg.clientId) throw new Error("login not configured");
  const disc = await fetchJson<Discovery>(
    `${cfg.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
  );
  const redirectUri = `${window.location.origin}${CALLBACK_PATH}`;
  const config: OidcClientConfig = {
    authorizationEndpoint: disc.authorization_endpoint,
    tokenEndpoint: disc.token_endpoint,
    clientId: cfg.clientId,
    redirectUri,
    scope: "openid",
  };
  const req = await buildAuthorizeRequest(config);
  const stash: Stash = {
    verifier: req.verifier,
    state: req.state,
    returnTo,
    tokenEndpoint: config.tokenEndpoint,
    clientId: cfg.clientId,
    redirectUri,
  };
  sessionStorage.setItem(STASH_KEY, JSON.stringify(stash));
  window.location.assign(req.url);
}

export type CallbackResult =
  /** Token stored; core validates `returnTo` again and navigates. */
  | { kind: "done"; returnTo: string }
  /** No code / missing stash — abandon quietly, show the manual affordance. */
  | { kind: "idle" }
  /** IdP error, state mismatch, or exchange failure — show the failure state. */
  | { kind: "error" };

/**
 * Callback phase: verify `state`, exchange the code, store the bearer, and
 * return the recovered return-to. Never throws on an expected non-happy path
 * (IdP error, mismatch, missing stash) — those map to a `CallbackResult`.
 */
export async function completeLogin(search: string): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  if (params.get("error")) return { kind: "error" }; // LG-14 — no exchange
  const code = params.get("code");
  const state = params.get("state");
  const raw = sessionStorage.getItem(STASH_KEY);
  if (!raw || !code || !state) return { kind: "idle" }; // LG-13 — safe landing
  const stash = JSON.parse(raw) as Stash;
  if (stash.state !== state) return { kind: "error" }; // LG-10 — no exchange
  const config: OidcClientConfig = {
    authorizationEndpoint: "",
    tokenEndpoint: stash.tokenEndpoint,
    clientId: stash.clientId,
    redirectUri: stash.redirectUri,
  };
  const tok = await exchangeCode(config, { code, verifier: stash.verifier });
  setAccessToken(tok.accessToken, tok.expiresIn);
  sessionStorage.removeItem(STASH_KEY);
  return { kind: "done", returnTo: stash.returnTo };
}
