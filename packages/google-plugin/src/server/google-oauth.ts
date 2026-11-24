/**
 * Google sign-in as a `PluginOAuthLoginFlow`, on `oauth4webapi` (PKCE, code exchange, id_token claim
 * validation incl. nonce). One flow, four return paths (design D12):
 *   local   — Desktop client, loopback callback on this host (browser on the dashboard host)
 *   paste   — Desktop client, loopback unreachable from the browser: paste the final URL
 *   web     — own Web client, Google redirects straight to `<base>/api/plugins/google/oauth/callback`
 *   return  — built-in Web client, Google redirects to the pi-dashboard.dev return page
 * Every path also accepts a pasted redirect URL. Errors are FIXED codes — never the input.
 * No `include_granted_scopes`: the request is the UNION of granted + required scopes (design D6).
 *
 * SECURITY: nothing here logs tokens, codes, the pasted URL or a client secret.
 * See change: add-google-connect.
 */
import { timingSafeEqual } from "node:crypto";
import {
  createLoopbackCallback,
  type PluginLoginInteraction,
  type PluginOAuthCredential,
  type PluginOAuthLoginFlow,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import * as oauth from "oauth4webapi";
import { RETURN_PAGE_URL } from "../shared/default-clients.js";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { scopeParam } from "../shared/products.js";
import type { ResolvedClient } from "./clients.js";
import type { DeliveredCode, PendingFlow, PendingFlows } from "./pending-flows.js";

export type SignInPath = "local" | "paste" | "web" | "return";

export const OAUTH_CALLBACK_PATH = "/api/plugins/google/oauth/callback";

/** Fixed, input-free error codes a flow can fail with. */
export class GoogleFlowError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = "GoogleFlowError";
  }
}

const SAFE_CODE = /^[a-z_]{1,64}$/;
const safeCode = (v: unknown, fallback: string): string => (typeof v === "string" && SAFE_CODE.test(v) ? v : fallback);

export interface GoogleSignInResult extends PluginOAuthCredential {
  sub: string;
  email: string;
  grantedScopes: string[];
  testingHint: boolean;
}

type CallbackFactory = typeof createLoopbackCallback;

export interface GoogleLoginOptions {
  client: ResolvedClient;
  endpoints: GoogleEndpoints;
  /** Scopes to request (the union of granted and required); `openid email` are added. */
  scopes: readonly string[];
  /** `select_account consent` for a new connect, `consent` for a product change / sign-in again. */
  prompt: string;
  path: SignInPath;
  loginHint?: string;
  pending: PendingFlows;
  /** Dashboard public base URL; required for `web` and `return`. */
  redirectBase?: string;
  /** Allowed dashboard origin for the return page `state` (only for `return`). */
  returnOrigin?: string;
  fetchImpl?: typeof fetch;
  createCallback?: CallbackFactory;
  now?: () => number;
}

function asServer(ep: GoogleEndpoints): oauth.AuthorizationServer {
  return { issuer: ep.issuer, authorization_endpoint: ep.authorize, token_endpoint: ep.token, revocation_endpoint: ep.revoke };
}

/** Options every oauth4webapi request gets (custom fetch + plain HTTP only under the loopback override). */
export function requestOptions(ep: GoogleEndpoints, fetchImpl?: typeof fetch, signal?: AbortSignal) {
  const o: Record<string | symbol, unknown> = {};
  if (ep.overridden) o[oauth.allowInsecureRequests] = true;
  if (fetchImpl) o[oauth.customFetch] = fetchImpl;
  if (signal) o.signal = signal;
  return o as oauth.TokenEndpointRequestOptions;
}

export const oauthServer = asServer;

export function oauthClient(c: Pick<ResolvedClient, "clientId">): oauth.Client {
  return { client_id: c.clientId };
}

/** Build the authorization URL. Pure. */
function buildAuthUrl(p: {
  endpoints: GoogleEndpoints;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  prompt: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const u = new URL(p.endpoints.authorize);
  const q = u.searchParams;
  q.set("client_id", p.clientId);
  q.set("redirect_uri", p.redirectUri);
  q.set("response_type", "code");
  q.set("scope", scopeParam(p.scopes));
  q.set("access_type", "offline");
  q.set("prompt", p.prompt);
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge", p.codeChallenge);
  q.set("code_challenge_method", "S256");
  if (p.loginHint) q.set("login_hint", p.loginHint);
  return u.toString();
}

function stateEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Parse a pasted redirect URL; a fixed-code `GoogleFlowError` that never contains the pasted input. */
function parsePastedRedirect(input: string, expectedState: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new GoogleFlowError("invalid_redirect");
  }
  const state = u.searchParams.get("state");
  if (!state) throw new GoogleFlowError("invalid_redirect");
  if (!stateEquals(state, expectedState)) throw new GoogleFlowError("state_mismatch");
  const error = u.searchParams.get("error");
  if (error) throw new GoogleFlowError(safeCode(error, "authorization_failed"));
  const code = u.searchParams.get("code");
  if (!code) throw new GoogleFlowError("invalid_redirect");
  return code;
}

/** Wait for the code from the path's own channel OR a pasted redirect, whichever comes first. */
async function waitForCode(
  ix: PluginLoginInteraction,
  channel: Promise<string>,
  state: string,
  cleanup: () => void,
): Promise<string> {
  const pasteAbort = new AbortController();
  const fromPaste = ix
    .prompt({
      type: "manual_code",
      message: "Paste the full URL your browser was redirected to (needed when the browser could not reach the dashboard)",
      placeholder: "…?code=…&state=…",
      signal: pasteAbort.signal,
    })
    .then((input) => parsePastedRedirect(input, state));
  // The loser must never surface as an unhandled rejection.
  channel.catch(() => {});
  fromPaste.catch(() => {});
  try {
    return await Promise.race([channel, fromPaste]);
  } finally {
    pasteAbort.abort();
    cleanup();
  }
}

function deliveredToCode(d: DeliveredCode): string {
  if (d.error) throw new GoogleFlowError(safeCode(d.error, "authorization_failed"));
  if (!d.code) throw new GoogleFlowError("invalid_redirect");
  return d.code;
}

function tokenError(err: unknown): GoogleFlowError {
  if (err instanceof GoogleFlowError) return err;
  if (err instanceof oauth.ResponseBodyError) return new GoogleFlowError(safeCode(err.error, "token_exchange_failed"));
  if (err instanceof oauth.OperationProcessingError) return new GoogleFlowError("id_token_invalid");
  return new GoogleFlowError("token_exchange_failed");
}

interface Channel {
  redirectUri: string;
  state: string;
  /** Resolves with the authorization code from the path's own return channel. */
  code: Promise<string>;
  cleanup: () => void;
}

const asFlowError = (fallback: string) => (err: unknown): never => {
  throw new GoogleFlowError(safeCode((err as { code?: unknown })?.code, fallback));
};

/** Open the path's return channel: a pending callback entry (web/return) or a loopback listener (local/paste). */
async function openChannel(opts: GoogleLoginOptions, ix: PluginLoginInteraction): Promise<Channel> {
  if (opts.path === "web" || opts.path === "return") {
    if (!opts.redirectBase) throw new GoogleFlowError("invalid_redirect");
    const pending: PendingFlow = opts.pending.create({ origin: opts.path === "return" ? opts.returnOrigin : undefined, signal: ix.signal });
    const redirectUri = opts.path === "return" ? RETURN_PAGE_URL : `${opts.redirectBase.replace(/\/+$/, "")}${OAUTH_CALLBACK_PATH}`;
    return { redirectUri, state: pending.state, code: pending.result.then(deliveredToCode, asFlowError("callback_failed")), cleanup: pending.cancel };
  }
  const mkCallback = opts.createCallback ?? createLoopbackCallback;
  const cb = await mkCallback({ path: "/", signal: ix.signal });
  return { redirectUri: cb.redirectUri, state: cb.state, code: cb.waitForCode().then((r) => r.code, asFlowError("callback_failed")), cleanup: cb.close };
}

interface Exchange {
  opts: GoogleLoginOptions;
  code: string;
  state: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
  signal: AbortSignal;
}

async function exchangeCode(x: Exchange): Promise<GoogleSignInResult> {
  const as = asServer(x.opts.endpoints);
  const client = oauthClient(x.opts.client);
  let tokens: oauth.TokenEndpointResponse;
  try {
    const params = oauth.validateAuthResponse(as, client, new URLSearchParams({ code: x.code, state: x.state }), x.state);
    const res = await oauth.authorizationCodeGrantRequest(
      as,
      client,
      oauth.ClientSecretPost(x.opts.client.clientSecret),
      params,
      x.redirectUri,
      x.verifier,
      requestOptions(x.opts.endpoints, x.opts.fetchImpl, x.signal),
    );
    tokens = await oauth.processAuthorizationCodeResponse(as, client, res, { expectedNonce: x.nonce, requireIdToken: true });
  } catch (err) {
    throw tokenError(err);
  }
  const claims = oauth.getValidatedIdTokenClaims(tokens);
  if (!claims || typeof claims.sub !== "string" || typeof claims.email !== "string") throw new GoogleFlowError("id_token_invalid");
  if (claims.email_verified !== true) throw new GoogleFlowError("email_unverified");
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
    expires: (x.opts.now ?? Date.now)() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
    sub: claims.sub,
    email: claims.email,
    grantedScopes: typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [],
    // Google adds `refresh_token_expires_in` only for time-limited (Testing-mode) grants.
    testingHint: typeof (tokens as Record<string, unknown>).refresh_token_expires_in === "number",
  };
}

/** Build the login flow for one connect / consent / sign-in-again. */
export function createGoogleLoginFlow(opts: GoogleLoginOptions): PluginOAuthLoginFlow {
  return {
    name: "Google",
    async login(ix): Promise<GoogleSignInResult> {
      const verifier = oauth.generateRandomCodeVerifier();
      const nonce = oauth.generateRandomNonce();
      const ch = await openChannel(opts, ix);
      const url = buildAuthUrl({
        endpoints: opts.endpoints,
        clientId: opts.client.clientId,
        redirectUri: ch.redirectUri,
        scopes: opts.scopes,
        prompt: opts.prompt,
        state: ch.state,
        nonce,
        codeChallenge: await oauth.calculatePKCECodeChallenge(verifier),
        loginHint: opts.loginHint,
      });
      ix.notify({
        type: "auth_url",
        url,
        instructions: "Sign in with Google. If this window does not come back to the dashboard, paste the final redirect URL below.",
      });
      const code = await waitForCode(ix, ch.code, ch.state, ch.cleanup);
      return exchangeCode({ opts, code, state: ch.state, redirectUri: ch.redirectUri, verifier, nonce, signal: ix.signal });
    },
  };
}

/** Revoke a token at Google (best effort, 5 s). `true` on 2xx; never throws, never logs. */
export async function revokeToken(ep: GoogleEndpoints, token: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(ep.revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
