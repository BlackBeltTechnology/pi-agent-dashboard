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
 * Bumped whenever the credential is dropped or may have changed hands (token
 * cleared, token replaced through the bare `setAccessToken`, acting operator
 * `(iss, sub)` changed, mode changed, reset) — but NOT on a same-operator
 * renewal through `setCredential` — so an async step can tell whether the
 * credential it started with is still the live one.
 */
let credentialEpoch = 0;
let operator: Operator | null = null;
const refusedListeners = new Set<() => void>();
const changeListeners = new Set<() => void>();

function notifyChange(): void {
  for (const l of changeListeners) l();
}

/** Subscribe to any change of mode / credential / operator; returns an unsubscribe fn. See change: add-team-plugin (AppHost.identity). */
export function onIdentityChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** The current identity mode. */
export function getIdentityMode(): IdentityMode {
  return mode;
}

/** Set the identity mode (normally done by `initIdentity`). */
export function setIdentityMode(next: IdentityMode): void {
  if (next !== mode) credentialEpoch += 1;
  mode = next;
  notifyChange();
}

/** The current credential epoch (see `credentialEpoch`). */
export function getCredentialEpoch(): number {
  return credentialEpoch;
}

/** The live access token, or null when not signed in. */
export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Set (or clear) the live access token alone. Without operator context a
 * replacement cannot be told from an account switch, so any change invalidates
 * in-flight work; renew through `setCredential` to keep it.
 */
export function setAccessToken(token: string | null): void {
  if (token !== accessToken || token === null) credentialEpoch += 1;
  accessToken = token;
  notifyChange();
}

const sameOperator = (a: Operator | null, b: Operator | null) => a?.iss === b?.iss && a?.sub === b?.sub;

/**
 * Atomically set the token and the operator it belongs to. A new token for the
 * SAME operator is a renewal and keeps in-flight work valid; a cleared token or
 * a different operator invalidates it.
 */
export function setCredential(token: string | null, next: Operator | null): void {
  if (token === null || !sameOperator(operator, next)) credentialEpoch += 1;
  accessToken = token;
  operator = next;
  notifyChange();
}

/** The acting operator, or null when nothing is signed in. */
export function currentOperator(): Operator | null {
  return operator;
}

/** Set (or clear) the acting operator. */
export function setActingOperator(next: Operator | null): void {
  if (!sameOperator(operator, next)) credentialEpoch += 1;
  operator = next;
  notifyChange();
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
  changeListeners.clear();
}
