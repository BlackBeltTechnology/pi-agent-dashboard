/**
 * Core identity-plane contracts shared by the dashboard server, the plugin
 * runtime, and resolver plugins. This module is identity-provider-AGNOSTIC:
 * it names the seam (principal shape, resolver/policy function signatures,
 * curated auth context) but knows nothing about Keycloak, JWTs, or JWKS —
 * that lives in the bundled `keycloak-resolver` plugin.
 *
 * See openspec change: add-multi-user-identity-plane
 *   - specs/principal-resolution, specs/host-access-policy
 *   - design.md D3 (outcome + lifetime), D5 (three-valued), D6 (context), D9 (policy)
 */

/**
 * An authenticated human principal. Exact `(iss, sub)` is the identity join
 * key; `email` — when present — is a non-authoritative display label only and
 * MUST NOT be used as an identity key. Frozen plain data once exposed.
 */
export type Principal = Readonly<{
  iss: string;
  sub: string;
  email?: string;
}>;

/**
 * A successful resolution: the principal plus the credential's expiry
 * (`expiresAt`, Unix epoch milliseconds, copied from the access-token `exp`)
 * so the lifetime can follow the identity onto a WebSocket ticket.
 */
export type PrincipalResolution = Readonly<{
  principal: Principal;
  expiresAt: number;
}>;

/**
 * A resolver's explicit "this credential is mine and it is INVALID" outcome.
 * Distinct from `null` ("not my credential"): a reject stops the chain
 * fail-closed and the request is answered 401. `reason` is for audit only.
 */
export type ResolverReject = Readonly<{
  reject: true;
  reason?: string;
}>;

/**
 * The three-valued resolver outcome (design D5):
 *   - `PrincipalResolution` — claim: credential valid, stop and authenticate.
 *   - `null`                — not owned: continue to the next resolver.
 *   - `ResolverReject`      — owned but invalid: stop, 401.
 */
export type ResolverOutcome = PrincipalResolution | ResolverReject | null;

/** Type guard: a successful resolution (has a `principal`). */
export function isPrincipalResolution(
  outcome: ResolverOutcome,
): outcome is PrincipalResolution {
  return outcome != null && "principal" in outcome;
}

/** Type guard: an explicit owned-invalid reject. */
export function isResolverReject(
  outcome: ResolverOutcome,
): outcome is ResolverReject {
  return outcome != null && "reject" in outcome && outcome.reject === true;
}

/**
 * Curated, bounded context handed to a resolver (design D6). Resolvers never
 * receive the raw request. `method`, canonical `url`, and the `dpop` header
 * permit RFC 9449 proof validation without a later schema change. `url` is the
 * externally-visible request URL with query/fragment stripped (design D6a).
 */
export type AuthContext = Readonly<{
  method: string;
  url: string;
  authorization?: string;
  cookie?: string;
  dpop?: string;
  isAuthenticated: boolean;
  ip: string;
}>;

/**
 * A principal resolver. Receives only the curated context; returns one of the
 * three outcomes. A resolver that OWNS a credential MUST catch its own
 * validation faults and return `reject` — never throw (design D5).
 */
export type PrincipalResolverFn = (
  ctx: AuthContext,
) => Promise<ResolverOutcome>;

/**
 * A stable host action constant, grouped by resource (design D9). The union is
 * intentionally open-ended per resource family; the host owns the constants,
 * the policy plugin interprets them.
 */
export type HostAction = string;

/**
 * A bounded plain-data descriptor identifying the target of a host action
 * without carrying secrets (design D9). Shape is per-`kind` and interpreted by
 * the policy plugin.
 */
export type HostResource = Readonly<{
  kind: string;
  [key: string]: unknown;
}>;

/**
 * The OPTIONAL host access policy (design D9). Governs only NON-session host
 * roads (fan-out, workspace/terminal/system, bootstrap disclosure). Session
 * roads are owner-gated, never routed here. When no policy is registered these
 * roads stay ungated. `false`/throw/timeout/non-boolean ⇒ deny.
 */
export type HostAccessPolicyFn = (input: {
  principal: Principal;
  action: HostAction;
  resource: HostResource;
}) => Promise<boolean>;

/**
 * A persisted session owner — the identity join key `(iss, sub)` only, never
 * the display `email`. Stamped on a session at spawn through a trusted road
 * (design D11) and compared by exact equality on every owner-gated access.
 */
export type PrincipalOwner = Readonly<{ iss: string; sub: string }>;

/**
 * Browser login descriptor a TRUSTED resolver plugin registers so the host can
 * advertise a pre-auth login config to the browser (`GET /api/identity/login-config`)
 * WITHOUT importing any provider-specific code (openspec add-multi-user-identity-plane,
 * D16, invariant I1). Core relays this verbatim; it never reads a resolver plugin's
 * own config keys.
 */
export interface BrowserLoginConfig {
  /** Owning resolver plugin id — the browser mounts the matching `login-provider`
   * client contribution by this id, never a different plugin's (D16, F6). */
  pluginId: string;
  /** Browser-reachable OIDC discovery/authorize base (the plugin's `browserIssuer`
   * falling back to its validation `issuer`). */
  issuer: string;
  /** Public PKCE client id advertised to the browser (the plugin's `browserClientId`). */
  clientId: string;
}

/** Exact `(iss, sub)` equality — no normalization, no email fallback. */
export function principalEquals(
  a: Pick<Principal, "iss" | "sub"> | null | undefined,
  b: Pick<Principal, "iss" | "sub"> | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.iss === b.iss && a.sub === b.sub;
}
