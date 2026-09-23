## Why

The dashboard cannot safely serve multiple human principals today. HTTP authentication collapses callers into `request.isAuthenticated`; browser WebSockets may bootstrap global session/workspace/terminal state, accept mutating commands by caller-supplied ids, and broadcast plugin domain events globally. A principal-resolution hook alone would identify the caller but would not prevent cross-user reads or writes.

Topology B is the chosen architecture (initiative `add-authentication-and-roles`, AUTH-FLOW §9): a public browser client obtains a Keycloak access token with Authorization Code + PKCE, holds the token, and the dashboard acts as the OAuth resource server. The dashboard must validate the bearer before its existing cookie-auth hook rejects the request, carry the verified identity and token expiry through the WebSocket ticket, and scope every host-owned session road to its owner.

Per the initiative's layering rule, **core supplies only the seam** (the resolution hook, the `(iss, sub)` shape, fail-closed default, and ordering); **the Keycloak validator ships as a bundled dashboard plugin**, replaceable by an override plugin; and **product authorization lives in the product plugin**, not in dashboard core.

## Activation model (no mode flag)

There is **no `identity.mode`**. The identity plane activates purely on the bundled resolver plugin being **enabled and configured**:

- **Resolver inert** — plugin disabled, or enabled but missing `issuer`/`audience`. Every request resolves to no principal; HTTP, ticket, WebSocket bootstrap, command, and broadcast behavior are **byte-for-byte identical to today**. This is "no auth otherwise."
- **Resolver active** — plugin enabled and configured. Bearer tokens resolve to a principal; session read/write roads are scoped to their owner; browser upgrades require an identity-bearing ticket.

**Self-lockout guard (design D21).** "Active" above means **enforced**, and enforcement arms only when the setup is **complete and consistent**: a trusted resolver is active **AND** a trusted plugin registered a browser login provider, with no `auth.providers` conflict (D8) and a named `trustedPolicyPlugin` resolving to exactly one policy (D9). Anything less — resolver without login site, login site without resolver, a plugin that fails to load, a D8/D9 conflict — leaves the plane **inert** (pre-change behavior) and logs one `[identity] identity is NOT enforced — …` line; **no identity misconfiguration aborts boot**, and a plugin that fails activation has its resolver/descriptor/policy registrations released. The decision is made once before `listen()` and latched for the process lifetime. Loopback is never re-admitted on the enforced path (a same-host sidecar / L4 load balancer makes remote traffic arrive as `127.0.0.1`).

"Default behaviour present out of the box" (initiative decision 3) is satisfied by the plugin shipping bundled and default-enabled; "no auth otherwise" is satisfied by it staying dormant until an operator supplies `issuer`+`audience`.

## What Changes

### Host identity plane — principal resolution (core seam)

- Add immutable `Principal { iss, sub, email? }`; exact `(iss, sub)` is the identity key and `email` is only a verified display label.
- Add `PrincipalResolution { principal, expiresAt }` so token lifetime can follow the identity onto a WebSocket.
- Add a bounded, DPoP-ready `AuthContext { method, url, authorization?, cookie?, dpop?, isAuthenticated, ip }`; resolvers never receive the raw request.
- Add one host resolver registry. The dispatch hook runs after the paired-device bearer hook but before the legacy cookie-auth hook can reject a request. A successful resolution sets `request.principal`, `request.principalExpiresAt`, and `request.isAuthenticated`; a resolver reject returns 401; `null` continues.
- Resolver registration requires an explicit host-owned trust grant: the bundled resolver, or a plugin named in `identity.trustedResolverPlugins`. Manifest priority controls ordering only and is never a trust boundary; equal priority is deterministic by plugin id.
- Validate, copy, and freeze resolver output before exposing it. Empty or malformed `iss`, `sub`, or expiry is rejected.
- The hook does nothing while the resolver is inert (registry empty or unconfigured), so an inert deployment is unchanged.

### Bundled Keycloak resolver plugin (`keycloak-resolver`)

- Ship a **bundled dashboard plugin** (`packages/keycloak-resolver-plugin`, manifest id `keycloak-resolver`), default-enabled, in `BUNDLED_PLUGINS`. Core imports nothing Keycloak-specific.
- It performs OIDC discovery, caches JWKS, and verifies RS256 signature plus exact `iss`, required `aud`, optional required `azp`, `exp`, and — when `cnf.jkt` is present — the DPoP proof (RFC 9449). A token without `cnf.jkt` validates as an ordinary bearer.
- Seed every Keycloak value from plugin settings via `getPluginConfig()`: `issuer`, `audience` (both required to activate), optional `authorizedParty`, `jwksUri`, `clockSkewSeconds`, `networkTimeoutMs`, and explicit `allowInsecureHttp` for controlled Docker development. No realm, hostname, port, client id, audience, or key is hardcoded. Missing `issuer`/`audience` ⇒ resolves every request to `null` (inert).
- Determine token ownership safely: opaque/device bearer or a JWT with another issuer returns `null`; a JWT claiming the configured issuer but failing validation returns reject.
- **Override:** an operator replaces the default by disabling it (`plugins.keycloak-resolver.enabled: false`) and trusting a different resolver plugin via `identity.trustedResolverPlugins`.
- When the resolver is active, the existing `auth.providers.*` confidential login connectors conflict with topology B; configuration validation refuses that mixed mode rather than silently creating a cookie-auth bypass.

### Client plane — browser as a public OIDC client

- **This is the bearer/ticket contract any frontend presents to the dashboard (D20).** In the current deployment that frontend is the user's own application; the dashboard's own React client is the optional adapter described below.
- The web client runs Authorization Code + PKCE against Keycloak, holds the access token in memory, and presents `Authorization: Bearer` on same-origin `/api`/`/v1` REST calls (distinct from the paired-device bearer).
- The client mints a browser-scope ws-ticket carrying the bearer and presents only `?ticket=` on the socket (the durable token never rides the WS, F6).
- The client answers the browser heartbeat and, on 401/expiry, re-acquires a token and reconnects.
- **Conditional DPoP:** when the realm issues sender-constrained tokens (`cnf.jkt`), the client generates a non-extractable key, binds it at the token endpoint, and sends a fresh proof per REST call and per ticket mint; when tokens are not bound, it omits proofs (zero-config downgrade).
- All of this engages only when the resolver is active; against an inert dashboard the client behaves exactly as today.

### Browser login: generic seam; the frontend is the deployment's choice

**Current deployment (authoritative; design D20).** The browser frontend is an **independent application — the user's own frontend, not the dashboard's bundled React client.** The dashboard is a **backend OAuth resource server only**: it validates the bearer and enforces ownership, and serves no login UI. A **custom independent server plugin** owns login UI, callback, and logout in its own **same-origin** pages (outside the network-guard jurisdiction) and performs the IdP authorize/code-exchange/end-session calls itself. It publishes only its redirect targets through the host's generic descriptor seam (`registerBrowserLoginConfig({ pluginId, loginUrl, logoutUrl })`); core relays that sanitized descriptor on the pre-auth `GET /api/identity/login-config` and redirects `/logout`. The user's token stays in that frontend's own memory and reaches the dashboard only as `Authorization: Bearer` plus a minted WS ticket. **Explicit non-goals: no BFF, no reverse proxy, no global cookies, no new production IdP, no cross-origin trust.**

- **Core exposes a seam, never speaks OIDC.** For the independent-frontend deployment core only relays the trusted descriptor and dispatches `/logout`; for the optional component adapter it additionally triggers and mounts the gate. Its descriptor endpoint is trust-filtered to the bundled resolver id or a plugin in the **current** `identity.trustedResolverPlugins` allowlist, while that resolver is active, and carries the owning `pluginId`. Core imports no OIDC/Keycloak code.
- **One descriptor, two optional provider kinds.** `GET /api/identity/login-config` returns `{ pluginId }` plus exactly one usable kind — `{ issuer, clientId }` (component) or `{ loginUrl, logoutUrl }` (separate view). Reachable pre-auth via BOTH the auth bypass and the network-guard public-path set. Server-side sanitization keeps `loginUrl`/`logoutUrl` same-origin paths and refuses unknown fields; otherwise the response is `{ active: false }` and the inert path is unchanged.
- **Optional bundled dashboard-client adapter (kept, not required).** A deployment whose frontend *is* the dashboard's own React client MAY use the bundled adapter: the trusted plugin claims `login-provider` with a **component only** (no function is carried through the manifest) and core mounts it pre-token on `/callback` and in a start phase, restores a same-origin-validated return-to, and routes the `auth_required` banner into it. The D16 specifics that made this *the* deployment are **superseded by D20**; the adapter stays in-tree as an option and no requirement of the independent-frontend deployment depends on it — in particular **the dashboard banner is not the entry point for an independent frontend**.
- **Token handoff is not a dependency.** The independent-frontend model does not require core to adopt a token from a URL fragment at boot; the spike's `#access_token=…` convention carries an informal "D20 handoff" label that is **not established spec**, and no core fragment-handoff capability is specified.
- **Dashboard-UI sign-in / sign-out (design D22, mockup approved by the user 2026-09-23).** When the dashboard's own React client is the frontend, the bearer arrives by a one-time `#pi_handoff` code exchanged at the plugin's `tokenUrl` and is kept **in memory only, no cookies**. The UI follows the approved mockup [`mockups/login-logout.html`](mockups/login-logout.html) (plan: [`mockups/ui-plan.md`](mockups/ui-plan.md)):
  - Signed out: the dashboard shell loads **empty** with **one** dialog, `Continue with <label>`, which navigates the tab **straight to the IdP** (`loginUrl` must redirect immediately). Replaces the amber `auth_required` banner.
  - Returning: the same dialog shows a spinner while the code is exchanged, then closes and sessions load.
  - Signed in: a **user line pinned to the bottom of the session list** (avatar, name, email, provider, `Sign out`). Nothing is added to the top header.
  - Expired / signed out / IdP error / several providers: the same dialog, each with a button that goes straight to the IdP.
  - Descriptor gains `tokenUrl`, `postLogoutUrl`, `label`, `endsProviderSession`; `/auth/status` returns the principal's `name`/`email` for the user line. `identity.loginProvider` pins one login plugin when several are installed.
- **Never locked out (design D23).** Localhost is **not** exempt while identity is enforced; it sees the same sign-in dialog. Recovery is Jupyter-style break-glass: `pi-dashboard login --local` uses the host-only `local-token` secret to print a one-time `http://localhost:<port>/?pi_local=<code>` link that signs in as the **local operator** (sees everything, in-memory bearer, logged). Together with D21 (incomplete setup stays inert), neither a misconfiguration nor an IdP outage can lock the host owner out.
- **Detachability is enforced by construction:** remove the resolver plugin ⇒ `login-config` reports `active:false`, no trusted descriptor exists, and core shows no login gate. Core stays OIDC-free.

### Session ownership and browser WebSockets

- Persist `principalOwner?: { iss, sub }` in session metadata and expose it on summaries. Compare field-by-field with exact string equality.
- Assign the owner only through trusted roads: browser `spawn_session` (socket principal), host HTTP spawn (request principal), or a trusted plugin passing the request principal through the owned-spawn API — correlated to the spawn **before** it is awaited. Automation and inert-era sessions remain ownerless; ownerless sessions are invisible to human principals.
- Enforce exact owner equality on every session read/write road when the resolver is active: HTTP detail/transcript/mutation, WS bootstrap snapshots, list/pagination, subscribe, replay/backfill, and inbound session commands. Owner equality needs **no** policy plugin — it is mechanical and always on once the resolver is active.
- Browser upgrades require a single-use identity-bearing ticket when the resolver is active. Cookie, local-token, trusted-network, or no-ticket browser upgrades do not bypass this.
- Tickets bind principal plus `expiresAt`; sockets copy both and close at token expiry. Browser heartbeat detects half-open transport only; it does not prove token validity.

### Optional host access policy (non-session roads only)

- Add one optional host access-policy contract `authorize({ principal, action, resource }) => Promise<boolean>`, registered only by an explicitly configured `identity.trustedPolicyPlugin`.
- **The policy is a host resource-dispatch gate, not the product authorization model.** It governs only **non-session** host-owned roads: domain-event fan-out, workspace/OpenSpec/branch/terminal/system bootstrap and commands, and bootstrap disclosure of non-session state.
- **When no policy is registered, non-session roads stay ungated** (today's behavior) — the resolver never implies a policy, and the policy never authenticates. Session roads remain owner-gated regardless.
- Bound policy calls by a configured timeout. Throw, timeout, or a non-boolean result denies that road and logs a structured reason.
- Product authorization (approver routing, atomic authorize+mutate, actor stamping) lives entirely in the product plugin, evaluated live against the resolved principal — never in dashboard core.

## Discipline Skills

Tasks in this change trigger these `eng-disciplines` skills:
- **security-hardening** — the whole change is auth/untrusted-input/session/token surface: JWT/JWKS/DPoP validation, the resolver trust grant, owner equality, and the WS bootstrap/command boundary.
- **observability-instrumentation** — the new auth gate, policy decisions, and denials require structured audit events so a refusal is diagnosable.
- **performance-optimization** — the resolver runs on every request's hot path; JWKS caching/coalescing and bounded timeouts sit on a latency budget.
- **doubt-driven-review** — applied during planning before this irreversible public-API/identity surface stands; re-apply before enabling the resolver in a live deployment.

## Capabilities

### New Capabilities

- `principal-resolution`: trusted, ordered, bounded principal resolution integrated into the actual auth gate, with immutable validated results and expiry metadata; inert until a resolver is active.
- `keycloak-principal-resolver`: bundled, config-seeded Keycloak resource-server validation (discovery/JWKS caching, conditional DPoP) with safe JWT/device/other-issuer disambiguation, shipped as a replaceable plugin.
- `browser-principal-client`: the reusable browser contract against the resource server — PKCE token acquisition held in memory, bearer on REST, identity-bearing ws-ticket mint, heartbeat reply, conditional DPoP proofs, **plus the generic browser-login seam: the pre-auth `GET /api/identity/login-config` descriptor source (`{pluginId, issuer/clientId | loginUrl/logoutUrl}`, trust-filtered to the current allowlist) and `/logout` dispatch. The optional bundled dashboard-client adapter (component-claimed `login-provider`: core-triggered login on active+no-token, a pre-auth `/callback` mount, return-to restore) is kept but is NOT required by the current deployment, whose frontend is the user's own application.**
- `websocket-principal-binding`: mandatory identity-bearing browser tickets when the resolver is active, principal+expiry attachment, expiry closure, and transport heartbeat.
- `session-ownership-scoping`: persisted owner assignment and exact owner enforcement across all HTTP and WS session read/write roads.
- `host-access-policy`: an optional, deny-by-default, plugin-supplied authorization gate for non-session host roads (fan-out, workspace/terminal/system, bootstrap disclosure); ungated when absent.

### Modified Capabilities

- `dashboard-shell-slots`: add one slot id `login-provider` to the frozen taxonomy — a plugin claims it with a **component only** (no function is carried through the manifest) to supply the optional bundled dashboard-client adapter's pre-auth callback/start component. The slot is inert when no plugin claims it; core mounts at most one login provider. It is optional and not part of the independent-frontend deployment (D20).

<!-- Existing wire formats remain backward compatible while the resolver is inert. An active resolver adds identity/ownership requirements rather than changing bridge-plane delivery classes or bridge ping/pong. -->

## Impact

- **Dashboard core:** auth-hook ordering; request decorators; plugin trust grants; session-road classification for owner equality; the optional policy seam.
- **Bundled resolver plugin (`packages/keycloak-resolver-plugin`):** Keycloak discovery, JWKS cache, JWT/conditional-DPoP validation, config schema; added to `BUNDLED_PLUGINS`.
- **Web client (`packages/client`):** PKCE flow, bearer on REST, identity ws-ticket mint, heartbeat, conditional DPoP; the generic browser-login descriptor seam + `/logout` dispatch; the **optional** bundled dashboard-client adapter (component `login-provider` + `/callback`), retained but not required by the current deployment.
- **Deployment frontend (not shipped here):** the user's own application is the browser client in the current deployment (D20); it signs in via a custom independent server plugin and presents only the bearer + WS ticket to this dashboard, which stays a resource server.
- **Browser gateway:** ticket-only browser upgrades when active; owner-scoped bootstrap/lists/detail/subscribe/replay/commands; token-expiry timer; heartbeat; optional policy-gated non-session roads and targeted fan-out.
- **Session persistence/shared protocol:** additive `principalOwner`; owner-filtered snapshots and pagination.
- **Configuration:** additive `identity` settings (`trustedResolverPlugins`, optional `trustedPolicyPlugin`, timeouts) plus `plugins.keycloak-resolver.*`. No mode flag. An active resolver rejects simultaneous legacy confidential login connectors.
- **Product plugins:** may register the one optional access policy and use the trusted owned-spawn path. Product authorization data and decisions remain outside dashboard core.
- **Security:** no self-declared manifest field grants identity power. No human authority gates on `isAuthenticated` alone. Owner equality is mechanical and always on when active.
- **Compatibility:** a dormant/unconfigured resolver preserves current behavior exactly. Enabling and configuring the resolver is the explicit cut-over; ownerless historical/automation sessions are hidden from human principals until deliberately adopted or respawned.

## Out of scope (recorded, consumed downstream)

- Canonical product store key `(cwd, invoiceId, principal)` and per-principal Ask key (initiative items 28/29) — the store is product-plugin-owned; owner equality hides the leak at the host boundary but the key change lands in the product plugin.
- RP-initiated logout / server session destruction (items 45–47) — under topology B the browser owns `end_session_endpoint`; the dashboard is a resource server with no session to destroy. Socket close at `principalExpiresAt` is the host-side equivalent.
- Migration/adoption of ownerless historical sessions, and the legacy `auth.providers` cookie-connector cut-over (a separate, breaking change).
- A BFF, reverse proxy, global/session cookie, new production IdP, or cross-origin trust for the login plane (D20) — the current deployment is an independent same-origin frontend against a resource-server-only dashboard.
- Core adoption of a token from a URL fragment at boot ("token handoff") — the spike's informal label is not established spec, and the current deployment does not depend on it.
