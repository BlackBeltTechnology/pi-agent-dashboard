/**
 * `/auth/status` semantics for the NO-legacy-cookie-auth path (D16 / H5).
 *
 * The client's WebSocket-refusal handler polls `/auth/status` to tell
 * `auth_required` (→ the browser login gate) from a plain `offline`. When no
 * legacy cookie auth-plugin is registered, `server.ts` serves this decision:
 *
 *   - No browser-login descriptor ⇒ the identity plane is inert; report the
 *     historical `{authenticated:true, authEnabled:false}` so nothing changes.
 *   - A descriptor IS active ⇒ an unauthenticated, non-genuinely-local caller
 *     is `{authenticated:false, authEnabled:true}` so the client escalates to
 *     the gate; a resolved bearer (`isAuthenticated`) OR a genuinely-local
 *     caller is authenticated.
 *
 * Pure so the (security-relevant) escalation trigger is unit-testable without
 * booting the server.
 */
export interface AuthStatusResponse {
  authenticated: boolean;
  authEnabled: boolean;
}

export function browserLoginAuthStatus(opts: {
  /** A trusted resolver published a browser-login descriptor. */
  descriptorActive: boolean;
  /** The resolver hook resolved a valid bearer principal for this request. */
  isAuthenticated: boolean;
  /** The request is a genuinely-local (loopback, no proxy hop) caller. */
  isGenuinelyLocal: boolean;
}): AuthStatusResponse {
  if (!opts.descriptorActive) return { authenticated: true, authEnabled: false };
  return { authenticated: opts.isAuthenticated || opts.isGenuinelyLocal, authEnabled: true };
}
