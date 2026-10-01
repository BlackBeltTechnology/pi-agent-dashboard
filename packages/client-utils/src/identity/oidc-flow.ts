/**
 * OIDC public-client authorization-code + PKCE flow helpers (openspec §12.1,
 * RFC 6749 §4.1 + RFC 7636). Pure functions over a resolved client config so
 * they unit-test without a live IdP; the UI glue (redirect + callback capture)
 * and the server-provided config live at the call site.
 */

import { createPkcePair, createRandomState, type PkcePair } from "./pkce.js";

/** Public-client OIDC config, sourced from the server/discovery at runtime. */
export interface OidcClientConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  /** Space-delimited scopes; defaults to `openid` when omitted. */
  scope?: string;
}

/** The transient state a caller stashes between authorize and callback. */
export interface AuthorizeRequest {
  url: string;
  verifier: string;
  state: string;
}

/** Normalized token-endpoint response. */
export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  /** Present when the IdP issued a `cnf.jkt`-bound (DPoP) token (§12.5). */
  tokenType: string;
  /** ID token, when issued — retained only as logout's `id_token_hint` (D18). */
  idToken?: string;
}

/**
 * Build the authorization-request URL (S256 PKCE) plus the `verifier`/`state`
 * the caller must retain to complete the exchange. Redirect the browser to
 * `url`; on return, match `state` and call `exchangeCode` with `verifier`.
 */
export async function buildAuthorizeRequest(
  config: OidcClientConfig,
  pkce?: PkcePair,
): Promise<AuthorizeRequest> {
  const pair = pkce ?? (await createPkcePair());
  const state = createRandomState();
  const q = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope ?? "openid",
    code_challenge: pair.challenge,
    code_challenge_method: pair.method,
    state,
  });
  return { url: `${config.authorizationEndpoint}?${q.toString()}`, verifier: pair.verifier, state };
}

/**
 * Exchange an authorization `code` + PKCE `verifier` for tokens at the token
 * endpoint. `extraHeaders` carries a DPoP proof when the flow is bound (§12.5).
 * Throws on a non-2xx response so the caller surfaces the auth failure.
 */
export async function exchangeCode(
  config: OidcClientConfig,
  input: { code: string; verifier: string },
  extraHeaders?: Record<string, string>,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_verifier: input.verifier,
  });
  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    id_token?: string;
  };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 0,
    tokenType: json.token_type ?? "Bearer",
    idToken: json.id_token,
  };
}
