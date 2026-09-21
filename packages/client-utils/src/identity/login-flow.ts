/**
 * Reusable browser OIDC login/logout mechanics (D16/D17/D18).
 *
 * Provider-agnostic engine for the identity seam: any dashboard plugin that
 * claims the core `login-provider` slot drives these functions to run the
 * browser half of an authorization-code + PKCE flow. Core ships NO login UI
 * and the token-resolver plugin ships none either — the login/logout UI is a
 * separate authorization plugin that imports this module (seam-only delivery).
 *
 * Pure of React so it unit-tests without jsdom. Reads/writes the shared
 * `token-store` singleton — the SAME module core's fetch wrapper reads, so a
 * token written here is visible to every subsequent `/api` request without any
 * handoff.
 *
 * `start` half: fetch the generic login descriptor (`/api/identity/login-config`)
 * → OIDC-discover the browser issuer → build a PKCE-S256 authorize request →
 * persist {verifier,state,returnTo,+endpoints} → redirect. `callback` half:
 * verify `state`, exchange the code, store the (plain bearer) token, report the
 * recovered return-to. `logout` half: clear tokens FIRST, then RP-initiated
 * logout redirect.
 *
 * Core owns return-to VALIDATION (open-redirect defence) and the post-callback
 * navigation; this module only persists the value core handed it and relays it
 * back via the callback result. DPoP-bound login is a documented non-goal
 * (B4/LG-19): a plain bearer is stored, no key is persisted across the redirect.
 */

import { buildAuthorizeRequest, exchangeCode, type OidcClientConfig } from "./oidc-flow.js";
import { clearAccessToken, getIdToken, setAccessToken, setIdToken } from "./token-store.js";

/** sessionStorage key holding the transient PKCE state across the redirect. */
export const STASH_KEY = "pi-identity:login";
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
  /** RP-initiated logout endpoint (D18). */
  end_session_endpoint?: string;
}

/** Why a login attempt failed (D17/R3) — rendered by the provider for diagnosis. */
export type LoginFailureReason =
  | "insecure-context"
  | "discovery-failed"
  | "exchange-failed"
  | "state-mismatch"
  | "idp-error";

/** Typed rejection from `beginLogin`/`beginLogout` so the provider can render a cause. */
export class LoginFlowError extends Error {
  readonly reason: LoginFailureReason;
  constructor(reason: LoginFailureReason, cause?: unknown) {
    super(reason, { cause });
    this.name = "LoginFlowError";
    this.reason = reason;
  }
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
  let cfg: LoginConfig;
  let disc: Discovery;
  try {
    cfg = await fetchJson<LoginConfig>("/api/identity/login-config");
    if (!cfg.active || !cfg.issuer || !cfg.clientId) throw new Error("login not configured");
    disc = await fetchJson<Discovery>(
      `${cfg.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    );
  } catch (err) {
    throw new LoginFlowError("discovery-failed", err);
  }
  const redirectUri = `${window.location.origin}${CALLBACK_PATH}`;
  const config: OidcClientConfig = {
    authorizationEndpoint: disc.authorization_endpoint,
    tokenEndpoint: disc.token_endpoint,
    clientId: cfg.clientId,
    redirectUri,
    scope: "openid",
  };
  let req: Awaited<ReturnType<typeof buildAuthorizeRequest>>;
  try {
    req = await buildAuthorizeRequest(config);
  } catch (err) {
    // Belt-and-braces (D17): with the pure-JS S256 fallback this arm is
    // normally unreachable, but a missing WebCrypto is still worth naming.
    throw new LoginFlowError(globalThis.crypto?.subtle ? "discovery-failed" : "insecure-context", err);
  }
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

/**
 * Logout phase (D18): the local tokens are cleared FIRST — a broken IdP can
 * never keep this browser signed in locally — then the browser is redirected
 * to the IdP's `end_session_endpoint` (OIDC RP-Initiated Logout 1.0) with
 * `client_id`, a same-origin `post_logout_redirect_uri`, and `id_token_hint`
 * when one was retained. Throws a typed `LoginFlowError` when the IdP side
 * cannot be reached (the local sign-out has already happened).
 */
export async function beginLogout(): Promise<void> {
  const idToken = getIdToken();
  clearAccessToken();
  let cfg: LoginConfig;
  let disc: Discovery;
  try {
    cfg = await fetchJson<LoginConfig>("/api/identity/login-config");
    if (!cfg.active || !cfg.issuer || !cfg.clientId) throw new Error("login not configured");
    disc = await fetchJson<Discovery>(
      `${cfg.issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`,
    );
    if (!disc.end_session_endpoint) throw new Error("no end_session_endpoint");
  } catch (err) {
    throw new LoginFlowError("discovery-failed", err);
  }
  const url = new URL(disc.end_session_endpoint);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("post_logout_redirect_uri", `${window.location.origin}/`);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  window.location.assign(url.toString());
}

export type CallbackResult =
  /** Token stored; core validates `returnTo` again and navigates. */
  | { kind: "done"; returnTo: string }
  /** No code / missing stash — abandon quietly, show the manual affordance. */
  | { kind: "idle" }
  /** IdP error, state mismatch, or exchange failure — show the failure state. */
  | { kind: "error"; reason: LoginFailureReason };

/**
 * Callback phase: verify `state`, exchange the code, store the bearer, and
 * return the recovered return-to. Never throws on an expected non-happy path
 * (IdP error, mismatch, missing stash) — those map to a `CallbackResult`.
 */
export async function completeLogin(search: string): Promise<CallbackResult> {
  const params = new URLSearchParams(search);
  if (params.get("error")) return { kind: "error", reason: "idp-error" }; // LG-14 — no exchange
  const code = params.get("code");
  const state = params.get("state");
  const raw = sessionStorage.getItem(STASH_KEY);
  if (!raw || !code || !state) return { kind: "idle" }; // LG-13 — safe landing
  const stash = JSON.parse(raw) as Stash;
  if (stash.state !== state) return { kind: "error", reason: "state-mismatch" }; // LG-10 — no exchange
  const config: OidcClientConfig = {
    authorizationEndpoint: "",
    tokenEndpoint: stash.tokenEndpoint,
    clientId: stash.clientId,
    redirectUri: stash.redirectUri,
  };
  try {
    const tok = await exchangeCode(config, { code, verifier: stash.verifier });
    setAccessToken(tok.accessToken, tok.expiresIn);
    if (tok.idToken) setIdToken(tok.idToken); // retained for logout's id_token_hint (D18)
  } catch {
    // Token endpoint unreachable or refused the exchange (D17/R3) — an
    // expected non-happy path, never an unhandled rejection.
    return { kind: "error", reason: "exchange-failed" };
  }
  sessionStorage.removeItem(STASH_KEY);
  return { kind: "done", returnTo: stash.returnTo };
}
