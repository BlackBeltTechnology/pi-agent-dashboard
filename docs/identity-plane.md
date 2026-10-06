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

## Break-glass operator (D23)

Recovery path for an IdP outage. Works with IdP down. Operator never locked out.

Flow:
- `pi-dashboard login --local` (`cmdLogin`, `packages/server/src/cli.ts`) reads 0600 local token → POST `/api/identity/local-code` (`x-pi-local-token` ONLY).
- `local-code` mints one-time code (≤ 60 s, single-use). Bound `MAX_OUTSTANDING_CODES = 32`.
- CLI prints `http://localhost:<port>/?pi_local=<code>`.
- Client boot redeems `?pi_local=<code>` → POST `/api/identity/local-exchange` (pre-auth, no guard) → in-memory `pi_op_` bearer.
- Bearer TTL 1 h. No cookies. Reload starts fresh (D22).
- Boot log names the command while enforced: `identity is ENFORCED. Locked out (IdP unreachable)? On this host run: pi-dashboard login --local`.

Code: `packages/server/src/identity/break-glass.ts`, `resolver-hook.ts`; client `packages/client/src/lib/identity/login-session.ts`.
- `pi_op_` bearer resolved host-side BEFORE any resolver (foreign JWT never looked up here). Dead `pi_op_` bearer → 401, not fall-through.
- Bearer resolves to reserved principal `LOCAL_OPERATOR` (`iss: urn:pi-dashboard:local-operator`, `sub: local-operator`). Matched by REFERENCE (`isLocalOperator`) — look-alike `(iss, sub)` is an ordinary non-owner.
- Resolvers cannot mint the reserved issuer (`sanitizePrincipalResolution` refuses the URN). Host-only local token (CLI/bridge, same OS user) also acts as operator while enforced (`sessionPrincipalOf`).
- Local operator sees everything; policy never consulted. In-memory per instance: restart invalidates every code + bearer. Only SHA-256 of secret stored.

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

## Host policy additions (18.37)

Bootstrap + live non-session frames gated PER FAMILY via `packages/server/src/identity/bootstrap-grants.ts`:
`workspace` / `openspec` / `branch` / `terminal`.
- Decided ONCE at WS upgrade (async), bound `ws.bootstrapGrants`, applied sync by gateway.
- No policy ⇒ allow all. No principal ⇒ deny all. Operator ⇒ allow all (policy not consulted).
- No grants under a policy ⇒ deny that family (fail-closed).

Plugin global frames route through `broadcastDomainEvent` → `deliverDomainEvent` (`packages/server/src/identity/domain-fanout.ts`):
- Ordered queue (`domainChain`), per-socket policy decision, operator bypass.
- `plugin_intents` + `plugin_config_update` exempt (own roads).

Road actions (`http-road-classification.ts`):
- `/editor/` ⇒ `editor.write` (any access = write capability).
- `/live/` ⇒ `live.<read|write>` by method verb.

`GET /api/identity/me` → `identityMe` asks policy with `probe: true` (advisory UI `can` map; never audited).

## Plugin consumer seam `ctx.identity` (D24)

`packages/server/src/identity/plugin-identity.ts`; type `PluginIdentitySeam` in `packages/dashboard-plugin-runtime/src/server/server-context.ts`.
Absent when host does not wire identity.

- `isEnforced()` — D21 latch.
- `principalOf(request)` — principal host resolved on a plugin HTTP route, else null.
- `principalOfUpgrade(req)` — principal behind a plugin WS upgrade's `Authorization` credential. Plugin WS scopes take no core ticket; this is how a WS route learns WHO connected. null ⇒ unauthenticated.
- `authorize(principal, action, resource)` — asks the ONE trusted policy (D9). Host namespaces action `plugin:<id>:<action>`. Action regex `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (no `:`, cannot leave namespace). No policy ⇒ true. Operator ⇒ true.
- `userDataDir(principal)` — `<plugin data root>/users/<sha256 of JSON [iss,sub]>`, 0700, stable per user. Never derived from raw `sub`.

## Terminal + live isolation (18.13)

Terminal owner:
- `TerminalSession.principalOwner` stamped at spawn while enforced (creating principal).
- kill / rename / close-inline owner-gated (`mayUseTerminal`, `packages/server/src/browser-handlers/terminal-handler.ts`); non-owner dropped before it touches the PTY.
- `terminal_added` / `terminal_updated` / `terminal_removed` + bootstrap reach owner only (operator all; ownerless none). `lastKnownOwner` lets `terminal_removed` still reach the owner after the PTY is gone.
- `/ws/terminal/<id>` upgrade needs a principal-bearing ticket (`mintWsTicket("terminal")`); PTY attach owner-gated, refused like a missing terminal.
- `/live/*` WS upgrade needs a principal-bearing ticket (`mintWsTicket("live")`).
- Residual: live previews carry NO per-user owner yet.

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
