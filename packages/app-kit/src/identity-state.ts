// Ported from InvoiceBot `src/auth/identity-state.ts`
// (BlackBeltTechnology/invoice-bot-dashboard); generalised with the identity
// mode (change: extract-standalone-app-kit, design D3).
//
// ONE module-level holder the whole browser reads: the identity mode, the live
// access token (owned by the OIDC client, mirrored here so non-React code — the
// fetch wrapper and the socket seam — can reach it), the acting operator
// `(iss, sub)`, and the "the server refused this token" signal so a refused
// token returns the operator to the sign-in state instead of looping.

export interface Operator {
  iss: string;
  sub: string;
  username?: string;
  name?: string;
}

/**
 * - `unknown`: the login descriptor has not been read yet — nothing is sent.
 * - `oidc`: the host publishes an OIDC provider (`issuer` + `clientId`).
 * - `none`: the host publishes no provider (`{active:false}`); requests go out
 *   without a credential and work only where the host admits the caller.
 * - `unavailable`: the descriptor read failed or is unusable — nothing is sent.
 */
export type IdentityMode = "unknown" | "oidc" | "none" | "unavailable";

let mode: IdentityMode = "unknown";
let accessToken: string | null = null;
/**
 * Bumped whenever the credential is dropped or changes hands (token cleared,
 * acting operator `(iss, sub)` changed, mode changed, reset) — NOT on a token
 * renewal for the same operator — so an async step can tell whether the
 * credential it started with is still the live one.
 */
let credentialEpoch = 0;
let operator: Operator | null = null;
const refusedListeners = new Set<() => void>();

/** The current identity mode. */
export function getIdentityMode(): IdentityMode {
  return mode;
}

/** Set the identity mode (normally done by `initIdentity`). */
export function setIdentityMode(next: IdentityMode): void {
  if (next !== mode) credentialEpoch += 1;
  mode = next;
}

/** The current credential epoch (see `credentialEpoch`). */
export function getCredentialEpoch(): number {
  return credentialEpoch;
}

/** The live access token, or null when not signed in. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Set (or clear) the live access token. */
export function setAccessToken(token: string | null): void {
  if (token === null) credentialEpoch += 1;
  accessToken = token;
}

/** The acting operator, or null when nothing is signed in. */
export function currentOperator(): Operator | null {
  return operator;
}

/** Set (or clear) the acting operator. */
export function setActingOperator(next: Operator | null): void {
  if (next?.iss !== operator?.iss || next?.sub !== operator?.sub) credentialEpoch += 1;
  operator = next;
}

/** Subscribe to "the server refused this token"; returns an unsubscribe fn. */
export function onSessionRefused(listener: () => void): () => void {
  refusedListeners.add(listener);
  return () => refusedListeners.delete(listener);
}

/** Signal a refused credential — the identity layer returns to the sign-in state. */
export function notifySessionRefused(): void {
  for (const listener of refusedListeners) listener();
}

/** Test-only: clear every holder and listener; mode back to `unknown`. */
export function resetIdentityState(): void {
  mode = "unknown";
  accessToken = null;
  credentialEpoch += 1;
  operator = null;
  refusedListeners.clear();
}
