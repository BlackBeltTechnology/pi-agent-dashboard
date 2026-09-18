# Identity Plane

Multi-user identity plane. OpenSpec change: `add-multi-user-identity-plane`.
Resolves a human `(iss, sub)` principal per request/socket. Gates session
ownership. Inert by default.

## Consumer rule

Gate on `request.principal` / `ws.principal`.
`principal` = resolved `(iss, sub)` identity, or `null`.
`null` principal = no resolved human = ownerless/inert path.
NEVER gate on `isAuthenticated`. No such flag exists.

## Activation model (no mode flag)

Plane activates on a principal resolver ENABLED + CONFIGURED.
No `identity.mode` flag. No single-user/multi-user switch.

Inert default (no resolver enabled):
- every HTTP/WS/bootstrap/command/broadcast outcome identical to pre-change.
- ownerless sessions visible to all (today's UX).

Active (resolver enabled + configured):
- every session read/write road (HTTP + WS) enforces owner equality.
- session persisted `(iss, sub)` owner must exactly equal requester principal.
- both `iss` AND `sub` match. No partial. No normalization.
- non-owner + principal-less + ownerless sessions invisible/immutable to humans.
- deny = 404. No owned-vs-not-found oracle.

## Bundled validator (core stays generic)

Keycloak validator ships as bundled `keycloak-resolver` plugin
(`packages/keycloak-resolver-plugin/`).
Core imports nothing Keycloak-specific. Core knows only abstract
principal-resolver seam.

Resolver trust host-owned:
- only bundled resolver, or plugin named in `identity.trustedResolverPlugins`,
  may register a resolver.

Issuer pinning:
- resolver rejects token whose `iss` differs from configured `issuer`.
- foreign issuer → `null`. Never persists ownership.
- pin issuer host + scheme + port before any `(iss, sub)` ownership persisted.

## Host policy (optional, non-session only)

Host access policy OPTIONAL.
Governs ONLY non-session host roads: workspace / OpenSpec / branch / terminal /
system + global domain-event fan-out.
Session roads owner-gated regardless of any policy.

One policy max. From plugin named in `identity.trustedPolicyPlugin`.
Fail-closed + bounded (`identity.policyTimeoutMs`):
deny / throw / timeout / non-boolean → denies that road.

Product authorization (roles, RBAC, per-feature perms) lives in PRODUCT plugin.
Not in core. Not in policy.
Authorization stays outside authentication.

## Non-human principals

Automation / host-internal roads run in-process. Not over HTTP.
Carry no principal. File no owner.
Sessions ownerless by construction. Never principal-gated.
Hidden from humans when active.

## Config keys

`packages/shared/src/config.ts` → `IdentityConfig`:
- `identity.trustedResolverPlugins` — resolver-plugin trust list.
- `identity.trustedPolicyPlugin` — single policy-plugin id.
- `identity.resolverTimeoutMs` — resolver call bound.
- `identity.policyTimeoutMs` — policy call bound.

## RFC references

- RFC 9068 — JWT access-token profile.
- RFC 9700 — OAuth 2.0 security best current practice.
- RFC 7636 — PKCE. Public browser client auth-code flow.
- RFC 9449 — DPoP. Sender-constrained tokens. Conditional in browser client plane.
