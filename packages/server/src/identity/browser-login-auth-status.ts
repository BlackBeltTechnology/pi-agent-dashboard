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
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

export interface AuthStatusResponse {
  authenticated: boolean;
  authEnabled: boolean;
  /** Who is signed in, for the dashboard user line (D22). Present only when a
   * bearer principal resolved. `iss` is deliberately not exposed. */
  principal?: { sub: string; name?: string; email?: string };
}

export function browserLoginAuthStatus(opts: {
  /** Identity is enforced (D21 latch). */
  enforced: boolean;
  /** The bearer PRINCIPAL the resolver hook resolved (not a device bearer), or null. */
  principal: Principal | null;
}): AuthStatusResponse {
  if (!opts.enforced) return { authenticated: true, authEnabled: false };
  // D21: while enforced a genuinely-local caller is NOT authenticated — the §9.2
  // upgrade refuses its principal-less socket, and loopback is not a trust
  // signal behind a same-host proxy/LB. Reporting it authenticated would make
  // the client settle on "offline" instead of `auth_required`.
  const p = opts.principal;
  if (!p) return { authenticated: false, authEnabled: true };
  return {
    authenticated: true,
    authEnabled: true,
    principal: { sub: p.sub, ...(p.name ? { name: p.name } : {}), ...(p.email ? { email: p.email } : {}) },
  };
}
