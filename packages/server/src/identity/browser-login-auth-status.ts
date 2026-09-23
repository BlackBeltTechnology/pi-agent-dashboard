/**
 * `/auth/status` semantics for the NO-legacy-cookie-auth path (D16 / H5).
 *
 * The client's WebSocket-refusal handler polls `/auth/status` to tell
 * `auth_required` (→ the browser login gate) from a plain `offline`. When no
 * legacy cookie auth-plugin is registered, `server.ts` serves this decision:
 *
 *   - No browser-login descriptor ⇒ the identity plane is inert; report the
 *     historical `{authenticated:true, authEnabled:false}` so nothing changes.
 *   - Identity ENFORCED (D21) ⇒ an unauthenticated caller — genuinely-local
 *     included — is `{authenticated:false, authEnabled:true}` so the client
 *     escalates to the gate; only a resolved bearer (`isAuthenticated`) is
 *     authenticated.
 *
 * Pure so the (security-relevant) escalation trigger is unit-testable without
 * booting the server.
 */
export interface AuthStatusResponse {
  authenticated: boolean;
  authEnabled: boolean;
}

export function browserLoginAuthStatus(opts: {
  /** Identity is enforced (D21 latch). */
  enforced: boolean;
  /** The resolver hook resolved a bearer PRINCIPAL for this request (not a device bearer). */
  isAuthenticated: boolean;
}): AuthStatusResponse {
  if (!opts.enforced) return { authenticated: true, authEnabled: false };
  // D21: while enforced a genuinely-local caller is NOT authenticated — the §9.2
  // upgrade refuses its principal-less socket, and loopback is not a trust
  // signal behind a same-host proxy/LB. Reporting it authenticated would make
  // the client settle on "offline" instead of `auth_required`.
  return { authenticated: opts.isAuthenticated, authEnabled: true };
}
