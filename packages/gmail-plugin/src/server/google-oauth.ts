/**
 * Google sign-in as a `PluginOAuthLoginFlow` (design D3), built on
 * `oauth4webapi` (PKCE, code exchange, id_token claim validation incl. nonce).
 *
 * - Loopback callback (`createLoopbackCallback`, path `/`, owns `state`, closes
 *   on `interaction.signal`) raced against a `manual_code` paste prompt.
 * - Pasted redirect: `code` + `state` parsed and compared to `callback.state`
 *   (length-checked, constant-time). Errors are FIXED codes — never the input.
 * - The losing branch always has a catch attached (no unhandled rejection).
 * - `email_verified` must be true; no `include_granted_scopes` (installed apps).
 *
 * SECURITY: nothing here logs tokens, codes, the pasted URL or the client secret.
 * See change: add-gmail-plugin.
 */
import { timingSafeEqual } from "node:crypto";
import {
  createLoopbackCallback,
  type PluginLoginInteraction,
  type PluginOAuthCredential,
  type PluginOAuthLoginFlow,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import * as oauth from "oauth4webapi";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { authScopeParam, type Tier } from "../shared/scopes.js";
import type { ClientRecord } from "./accounts.js";

/** Fixed, input-free error codes a flow can fail with (the wizard maps them to steps). */
export class GmailFlowError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GmailFlowError";
  }
}

const SAFE_CODE = /^[a-z_]{1,64}$/;
const safeCode = (v: unknown, fallback: string): string =>
  typeof v === "string" && SAFE_CODE.test(v) ? v : fallback;

export interface GoogleSignInResult extends PluginOAuthCredential {
  sub: string;
  email: string;
  grantedScopes: string[];
  tier: Tier;
  testingHint: boolean;
}

type CallbackFactory = typeof createLoopbackCallback;

export interface GoogleLoginOptions {
  client: ClientRecord;
  endpoints: GoogleEndpoints;
  tier: Tier;
  /** Email of the account being re-authenticated (sets `login_hint`). */
  loginHint?: string;
  /** Test seam: fetch used for the token endpoint. */
  fetchImpl?: typeof fetch;
  /** Test seam: loopback callback factory. */
  createCallback?: CallbackFactory;
  now?: () => number;
}

function asServer(ep: GoogleEndpoints): oauth.AuthorizationServer {
  return { issuer: ep.issuer, authorization_endpoint: ep.authorize, token_endpoint: ep.token, revocation_endpoint: ep.revoke };
}

/** Options every oauth4webapi request gets (custom fetch + plain-HTTP only under the loopback override). */
export function requestOptions(ep: GoogleEndpoints, fetchImpl?: typeof fetch, signal?: AbortSignal) {
  const o: Record<string | symbol, unknown> = {};
  if (ep.overridden) o[oauth.allowInsecureRequests] = true;
  if (fetchImpl) o[oauth.customFetch] = fetchImpl;
  if (signal) o.signal = signal;
  return o as oauth.TokenEndpointRequestOptions;
}

export function oauthServer(ep: GoogleEndpoints): oauth.AuthorizationServer {
  return asServer(ep);
}

export function oauthClient(c: ClientRecord): oauth.Client {
  return { client_id: c.clientId };
}

/** Build the authorization URL (design D3 step 2). Pure — test E4. */
export function buildAuthUrl(p: {
  endpoints: GoogleEndpoints;
  clientId: string;
  redirectUri: string;
  tier: Tier;
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
  q.set("scope", authScopeParam(p.tier));
  q.set("access_type", "offline");
  q.set("prompt", "consent select_account");
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

/**
 * Parse a pasted redirect URL (design D3 step 3). Returns the code, or throws a
 * fixed-code `GmailFlowError` (`invalid_redirect` / `state_mismatch` / a Google
 * error code) that never contains the pasted input. Test E9.
 */
export function parsePastedRedirect(input: string, expectedState: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new GmailFlowError("invalid_redirect");
  }
  const state = u.searchParams.get("state");
  if (!state) throw new GmailFlowError("invalid_redirect");
  if (!stateEquals(state, expectedState)) throw new GmailFlowError("state_mismatch");
  const error = u.searchParams.get("error");
  if (error) throw new GmailFlowError(safeCode(error, "authorization_failed"));
  const code = u.searchParams.get("code");
  if (!code) throw new GmailFlowError("invalid_redirect");
  return code;
}

/** Wait for the loopback callback OR a pasted redirect, whichever comes first. */
async function waitForCode(
  ix: PluginLoginInteraction,
  cb: Awaited<ReturnType<CallbackFactory>>,
): Promise<string> {
  const pasteAbort = new AbortController();
  const fromCallback = cb.waitForCode().then(
    (r) => r.code,
    (err: unknown) => {
      throw new GmailFlowError(safeCode((err as { code?: unknown })?.code, "callback_failed"));
    },
  );
  const fromPaste = ix
    .prompt({
      type: "manual_code",
      message: "Paste the full URL your browser was redirected to (needed when the dashboard runs on another machine)",
      placeholder: "http://127.0.0.1:…/?code=…&state=…",
      signal: pasteAbort.signal,
    })
    .then((input) => parsePastedRedirect(input, cb.state));
  // The loser must never surface as an unhandled rejection.
  fromCallback.catch(() => {});
  fromPaste.catch(() => {});
  try {
    return await Promise.race([fromCallback, fromPaste]);
  } finally {
    pasteAbort.abort();
    cb.close();
  }
}

function tokenError(err: unknown): GmailFlowError {
  if (err instanceof GmailFlowError) return err;
  if (err instanceof oauth.ResponseBodyError) return new GmailFlowError(safeCode(err.error, "token_exchange_failed"));
  if (err instanceof oauth.OperationProcessingError) return new GmailFlowError("id_token_invalid");
  return new GmailFlowError("token_exchange_failed");
}

/** Build the login flow for one add / re-auth / level raise. */
export function createGoogleLoginFlow(opts: GoogleLoginOptions): PluginOAuthLoginFlow {
  const mkCallback = opts.createCallback ?? createLoopbackCallback;
  const now = opts.now ?? Date.now;
  return {
    name: "Google (Gmail)",
    async login(ix): Promise<GoogleSignInResult> {
      const as = asServer(opts.endpoints);
      const client = oauthClient(opts.client);
      const cb = await mkCallback({ path: "/", signal: ix.signal });
      const verifier = oauth.generateRandomCodeVerifier();
      const nonce = oauth.generateRandomNonce();
      const url = buildAuthUrl({
        endpoints: opts.endpoints,
        clientId: opts.client.clientId,
        redirectUri: cb.redirectUri,
        tier: opts.tier,
        state: cb.state,
        nonce,
        codeChallenge: await oauth.calculatePKCECodeChallenge(verifier),
        loginHint: opts.loginHint,
      });
      ix.notify({
        type: "auth_url",
        url,
        instructions: "Sign in with Google. If the dashboard runs on another machine, paste the final redirect URL below.",
      });
      const code = await waitForCode(ix, cb);

      let tokens: oauth.TokenEndpointResponse;
      try {
        const params = oauth.validateAuthResponse(as, client, new URLSearchParams({ code, state: cb.state }), cb.state);
        const res = await oauth.authorizationCodeGrantRequest(
          as,
          client,
          oauth.ClientSecretPost(opts.client.clientSecret),
          params,
          cb.redirectUri,
          verifier,
          requestOptions(opts.endpoints, opts.fetchImpl, ix.signal),
        );
        tokens = await oauth.processAuthorizationCodeResponse(as, client, res, {
          expectedNonce: nonce,
          requireIdToken: true,
        });
      } catch (err) {
        throw tokenError(err);
      }
      const claims = oauth.getValidatedIdTokenClaims(tokens);
      if (!claims || typeof claims.sub !== "string" || typeof claims.email !== "string") {
        throw new GmailFlowError("id_token_invalid");
      }
      if (claims.email_verified !== true) throw new GmailFlowError("email_unverified");
      const granted = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : [];
      return {
        type: "oauth",
        access: tokens.access_token,
        refresh: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
        expires: now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
        sub: claims.sub,
        email: claims.email,
        grantedScopes: granted,
        tier: opts.tier,
        // Google adds `refresh_token_expires_in` only for time-limited (Testing-mode) grants.
        testingHint: typeof (tokens as Record<string, unknown>).refresh_token_expires_in === "number",
      };
    },
  };
}
