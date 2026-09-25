/**
 * In-memory access-token store for the browser identity plane (openspec §12.1).
 *
 * The access token is held in a module-scoped variable — NEVER localStorage /
 * sessionStorage / cookie (RFC 9700 public-client guidance: an access token in
 * web storage is XSS-exfiltratable). It lives only for the tab's lifetime; a
 * reload re-runs the PKCE flow (silent via the IdP session when present).
 *
 * Distinct from the paired-device bearer (`lib/pairing/device-auth.ts`), which
 * is a durable localStorage credential for a phone paired via `/pair`. The two
 * never mix: the identity-plane bearer is this in-memory token.
 */

interface TokenState {
  accessToken: string;
  /** Epoch ms after which the token is treated as expired (from `expires_in`). */
  expiresAt: number;
}

let state: TokenState | null = null;

/** ID token retained solely as a future `id_token_hint` for RP-initiated logout (D18). */
let idToken: string | null = null;

/**
 * Store an access token with its `expires_in` (seconds). A non-positive or
 * missing lifetime stores the token with an already-past expiry, so a caller
 * that ignores `expiresAt` still gets a token while a caller that honors it
 * treats it as needing refresh.
 */
export function setAccessToken(accessToken: string, expiresInSeconds: number): void {
  state = { accessToken, expiresAt: Date.now() + Math.max(0, expiresInSeconds) * 1000 };
}

/** The current access token, or null when absent or expired. */
export function getAccessToken(now: number = Date.now()): string | null {
  if (!state) return null;
  if (now >= state.expiresAt) return null;
  return state.accessToken;
}

/** Epoch ms the current token expires at, or null when no token is held. */
export function getExpiresAt(): number | null {
  return state?.expiresAt ?? null;
}

/** True when a live (non-expired) token is held. */
export function hasLiveToken(now: number = Date.now()): boolean {
  return getAccessToken(now) !== null;
}

/** Retain the id_token (in-memory only) for logout's `id_token_hint` (D18). */
export function setIdToken(token: string): void {
  idToken = token;
}

/** The retained id_token, or null. Not lifetime-checked — hint use only. */
export function getIdToken(): string | null {
  return idToken;
}

/** Forget the in-memory tokens (logout / expiry / reconnect-on-401). */
export function clearAccessToken(): void {
  state = null;
  idToken = null;
}
