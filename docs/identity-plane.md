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

## Three-way split (D18/D19/D22/D25)

No login UI in core. No login UI in `keycloak-resolver`. Three owners.

| Part | Owns | Never owns |
|------|------|-----------|
| Core | Seam only: `login-provider` slot (phases `start` / `callback` / `logout`); `/callback` + `/logout` routes; `GET /api/identity/login-config`; trust-bound provider selection; return-to validation; owner gate; optional policy dispatch. | Any login UI. Any provider-specific code. |
| `keycloak-resolver-plugin` | Token resolver ONLY: validates bearer (RFC 9068 + conditional DPoP) → `(iss, sub)`. | `login-provider` claim. Browser-login descriptor. Client bundle. `browserClientId` / `browserIssuer` config. |
| authz / login plugin | Login + logout UI. Optional custom resolver. Optional host access policy. | — |

Authz plugin claims a seat one of two ways (D19):

- COMPONENT kind: claims `login-provider` slot. Core mounts plugin React contribution from build-time `PLUGIN_REGISTRY`. Ships into client bundle → needs dashboard rebuild. Publishes `ctx.registerBrowserLoginConfig({ issuer, clientId })`.
- SEPARATE-VIEW kind (D20): serves own pages on `ctx.fastify` OUTSIDE guard jurisdiction (`/api/` `/v1/` `/editor/` `/live/`) → reachable pre-auth. Claims NO slot. Ships nothing into client bundle → drop-in, no rebuild. Publishes `ctx.registerBrowserLoginConfig({ loginUrl, logoutUrl, tokenUrl?, postLogoutUrl?, label?, endsProviderSession?, silentSignIn? })`.

Host sanitizes every descriptor (`sanitizeBrowserLoginConfig`): same-origin paths only; `/callback` + `/logout` refused; unknown fields dropped. Host stamps `pluginId`.
Trust: descriptor honored only from bundled resolver id or `identity.trustedResolverPlugins`, and only while resolver active.
Core mounts / redirects the `pluginId`'s OWN provider — never another plugin's (F6).
Several providers coexist. `login-config` returns `providers: [...]`. Login page lists one button each (D25).

Login mechanics live in `client-utils` (seam-only delivery). Authz plugin imports them; no login UI ships in-tree:
- `login-flow.ts` — `beginLogin(returnTo)` (fetch `/api/identity/login-config` → OIDC discover → PKCE S256 authorize → stash `{verifier,state,returnTo}` in sessionStorage → redirect); `completeLogin(search)` (verify `state` → `exchangeCode` → `setAccessToken` → return returnTo); `beginLogout()` (clear tokens FIRST → RP-initiated logout via `end_session_endpoint` + `client_id` + same-origin `post_logout_redirect_uri` + `id_token_hint` when held).
- `pkce.ts` (S256, R1 fallback), `oidc-flow.ts` (`buildAuthorizeRequest` / `exchangeCode`), `token-store.ts` (in-memory access + id token; shared with core fetch wrapper).
- `LoginFlowError.reason` → `insecure-context` | `discovery-failed` | `exchange-failed` | `state-mismatch` | `idp-error`.

D22 dashboard-UI mode: no cookies. One-time handoff `#pi_handoff=<code>` → `POST tokenUrl {code, verifier}` → in-memory bearer. Bearer rides `Authorization: Bearer` on REST + `POST /api/ws-ticket`.

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

## Plain-HTTP / Tailscale deployment

Supported after R1 (insecure-context resilience; tasks §14, design D17).
Browser login works on plain-HTTP non-loopback origins (`http://<tailnet-ip>:<port>`).
`crypto.subtle` absent (secure-context-only API).
`deriveCodeChallenge` (`packages/client-utils/src/identity/pkce.ts`) falls back to vendored pure-JS SHA-256 (`sha256Bytes`, FIPS 180-4, test-vectored vs WebCrypto).
Method stays `S256`. `plain` never sent (RFC 9700). `crypto.getRandomValues` never polyfilled.

Tailscale topology: bind server `0.0.0.0` (`--host` / `PI_DASHBOARD_HOST` / `bindHost`).
Set `issuer` + `browserIssuer` to browser-reachable base (`http://<tailnet-ip>:8080/realms/<realm>`).
`iss` matches for browser and validator.
`allowInsecureHttp: true` required for http issuer.
Transport rides WireGuard-encrypted tailnet.
`tailscale serve` HTTPS = recommended hardening. Put Keycloak on HTTPS too — avoids mixed content.
Switch validation `issuer` + browser-reachable `issuer` to the `https://…ts.net` base when serving.

Keycloak public client checklist (public client, no secret, PKCE):
- `redirectUris` list `http://<tailnet-ip>:<port>/callback` + `/*`.
- `webOrigins` list dashboard origin (token endpoint browser CORS fetch).

Failure UX: gate failures carry typed reasons (`insecure-context` | `discovery-failed` | `exchange-failed` | `state-mismatch` | `idp-error`).
Authz plugin renders reason with retry + return-home (mechanics `packages/client-utils/src/identity/login-flow.ts`).
`/auth/status` probe rejection no longer flips client to "Server offline".
`authenticated:false` always wins as `auth_required` (sign-in affordance stays).
Offline only after 3 consecutive probe rejections (`packages/client/src/hooks/useWebSocket.ts`).

Lockout floor: loopback operator always admitted (`isGenuinelyLocal`). Broken resolver config fails open to single-machine behavior.

## RFC references

- RFC 9068 — JWT access-token profile.
- RFC 9700 — OAuth 2.0 security best current practice.
- RFC 7636 — PKCE. Public browser client auth-code flow.
- RFC 9449 — DPoP. Sender-constrained tokens. Conditional in browser client plane.

See also `docs/identity-auth-plugin-guide.md` — build a login/authz plugin.
