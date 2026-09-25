## Purpose

The reusable browser contract against this dashboard as an OAuth resource server: acquire a Keycloak
access token with Authorization Code + PKCE, hold it in memory, present it as a bearer on REST calls,
mint an identity-bearing WebSocket ticket, answer the transport heartbeat, and — when the realm issues
sender-constrained tokens — attach conditional DPoP proofs. It also defines the generic browser-login
seam: the pre-auth `GET /api/identity/login-config` descriptor source and core's `/logout` dispatch.
All of this engages only when the dashboard's resolver is active; against an inert dashboard the
browser behaves exactly as before this change.

**Current deployment (design.md D20).** The browser frontend is the user's own independent
application; the dashboard is a backend **resource server only** and serves no login UI. A custom
independent server plugin owns login, callback, and logout and publishes only redirect targets
(`loginUrl`/`logoutUrl`) through the descriptor seam. Requirements below that name **the client** are
the bearer/ticket contract that frontend presents to the dashboard. Requirements that name **the
dashboard's own client** describe the **optional bundled dashboard-client adapter** (a trusted
plugin's component `login-provider`), which is kept in-tree but is not required by this deployment.

## ADDED Requirements

### Requirement: Public-client PKCE token acquisition

The client SHALL obtain a Keycloak access token via Authorization Code with PKCE as a public client
(no client secret in the browser) and SHALL hold the access token in memory only (not `localStorage`),
to limit token theft via XSS.

#### Scenario: Client completes a PKCE exchange
- **WHEN** the client has no live token and the resolver is active
- **THEN** it runs Authorization Code + PKCE and receives an access token
- **AND** the access token is held in memory, not persisted to `localStorage`

#### Scenario: No client secret is present in the browser
- **WHEN** the client performs the token exchange
- **THEN** it sends a PKCE code verifier and no client secret

### Requirement: Bearer attached to REST calls

The client SHALL attach `Authorization: Bearer <access-token>` to same-origin `/api` and `/v1`
requests, distinct from the paired-device bearer, and SHALL NOT override an explicit `Authorization`
header already set on a request.

#### Scenario: Human bearer rides same-origin API calls
- **WHEN** the client has an access token and issues a same-origin `/api` request
- **THEN** the request carries `Authorization: Bearer <access-token>`

#### Scenario: Explicit header is not overridden
- **WHEN** a request already sets its own `Authorization` header
- **THEN** the client does not replace it

### Requirement: Identity-bearing WebSocket ticket

The client SHALL mint a browser-scope WebSocket ticket using its bearer and SHALL present only
`?ticket=` on the socket URL; the durable access token SHALL NOT ride the WebSocket.

#### Scenario: Unpaired human browser mints a ticket when active
- **WHEN** the resolver is active and an unpaired human browser (re)connects the WebSocket
- **THEN** the client mints a fresh single-use ticket via the bearer and presents only `?ticket=`
- **AND** the access token never appears on the WebSocket URL

### Requirement: Heartbeat reply and re-authentication

The client SHALL answer the browser transport heartbeat, and on a 401 or when the token reaches
`principalExpiresAt` SHALL silently re-acquire a token and reconnect.

#### Scenario: Client reconnects on token expiry
- **WHEN** the socket closes at `principalExpiresAt`
- **THEN** the client re-acquires an access token, mints a new ticket, and reconnects

### Requirement: Conditional DPoP proofs

When the token endpoint returns a sender-constrained token (`cnf.jkt`), the client SHALL generate a
non-extractable key, bind it at the token request, and attach a fresh DPoP proof per REST call and per
ticket mint. When the token is not bound, the client SHALL omit proofs. The downgrade SHALL require no
configuration.

#### Scenario: Bound token attaches proofs
- **WHEN** the realm issues a `cnf.jkt`-bound access token
- **THEN** the client sends a DPoP proof on each REST call and ticket mint

#### Scenario: Unbound token omits proofs
- **WHEN** the realm issues an unbound access token
- **THEN** the client sends no DPoP proof and REST calls still succeed

### Requirement: Inert dashboard leaves the client unchanged

When the dashboard's resolver is inert, the client SHALL NOT run PKCE, attach a human bearer, or mint
an identity ticket; its behavior SHALL be identical to before this change.

#### Scenario: Client is inert against an inert dashboard
- **WHEN** the dashboard signals the identity plane is inert
- **THEN** the client behaves exactly as it did before this change (no PKCE, no bearer, no ticket)

### Requirement: Pre-auth browser login config

The host SHALL expose `GET /api/identity/login-config` reachable without authentication — via BOTH the
auth-plugin bypass AND the universal network guard's public in-namespace path set — returning
`{ pluginId }` plus exactly one usable provider kind: `{ issuer, clientId }` (component) OR
`{ loginUrl, logoutUrl }` (separate view). The response SHALL be relayed from the descriptor the
active trusted provider's server plugin registered with the host (`registerBrowserLoginConfig`); core
SHALL NOT read the provider plugin's own config keys. Provider trust SHALL be sourced from the
**current** allowlist — the bundled resolver id or a plugin named in
`identity.trustedResolverPlugins` — and SHALL hold only while that resolver is active; manifest
priority SHALL NOT select a provider. The host SHALL sanitize the descriptor (same-origin paths only,
core's own gate routes refused, unknown fields dropped, at least one usable kind required) and SHALL
include the owning `pluginId` so core never mixes one plugin's config with another's. When no usable
descriptor is registered, the response SHALL be `{ active: false }` and SHALL disclose no plugin id,
issuer, client id, or URL.

#### Scenario: Active trusted provider advertises login
- **WHEN** the resolver is active and its server plugin registered a usable descriptor
- **THEN** `GET /api/identity/login-config` returns `{ active: true, pluginId, … }` with either `{ issuer, clientId }` or `{ loginUrl, logoutUrl }` and no authentication required

#### Scenario: Inert, untrusted, or unusable provider advertises no login
- **WHEN** the resolver is inert, or a plugin not in the current allowlist registered a descriptor, or the registered descriptor has no usable kind
- **THEN** the endpoint returns `{ active: false }` and discloses no plugin id, issuer, client id, or URL

#### Scenario: Descriptor redirect targets are sanitized at the trust boundary
- **WHEN** a trusted provider registers a `loginUrl`/`logoutUrl` that is not a same-origin path, or that targets a core gate route
- **THEN** the host rejects that field and the endpoint discloses no usable kind rather than an off-origin redirect target

### Requirement: Optional component adapter — core-triggered gate, plugin-owned OIDC

This requirement governs **only** the optional bundled dashboard-client adapter, **not** the current
deployment (design.md D20). When the dashboard's own client is the browser frontend, the resolver is
active, and no live token is held, core SHALL stash the current URL as a return-to and mount the
single trusted `login-provider` contribution's **component** — a `component` name only; no
`startLogin` function is carried through the manifest — which begins the provider's authorization
flow. The core SHALL NOT itself run OIDC discovery, PKCE, or token exchange; those SHALL be performed
by the component. When no trusted `login-provider` is claimed, the core SHALL render no login gate.
Nothing in this requirement SHALL be required of a deployment whose browser frontend is an
independent application.

#### Scenario: Active plane with no token mounts the trusted component
- **WHEN** the dashboard's own client is the frontend, the resolver is active, no live token is held, and a trusted `login-provider` is claimed
- **THEN** the core stashes the current URL and mounts that component, which redirects the browser to the issuer's authorize endpoint via PKCE

#### Scenario: No login provider means no gate
- **WHEN** no trusted `login-provider` component is claimed
- **THEN** the core renders no login gate and does not attempt OIDC

### Requirement: Separate-view provider redirection

When the active trusted descriptor is the separate-view kind, core SHALL NOT mount a component or run
OIDC. Core SHALL redirect `/logout` to `logoutUrl`, and SHALL treat `loginUrl` as the sign-in entry
point for the browser, reachable as a plain link needing no dashboard client JS. Core SHALL NOT fall
back from `logoutUrl` to `loginUrl`, so signing out can never sign the browser back in.

#### Scenario: Logout redirects to the provider's logout URL
- **WHEN** the active descriptor is the separate-view kind and the browser requests `/logout`
- **THEN** core redirects to `logoutUrl` and never to `loginUrl`

#### Scenario: Sign-in entry point is a plain link
- **WHEN** the active descriptor is the separate-view kind and the browser is unauthenticated
- **THEN** the sign-in entry point links to `loginUrl` and works with no dashboard client JS

### Requirement: Pre-auth callback mount and return-to restore

For the optional component adapter, the core SHALL mount a pre-token `/callback` route (rendered before
the authed shell) that renders the trusted `login-provider` component. The callback component SHALL
verify the CSRF `state`, exchange the authorization code for a token, and write it to the in-memory
token store. On success, the core — not the plugin — SHALL navigate to the stashed return-to URL. A
`state` mismatch SHALL abort the exchange and store no token. For the separate-view kind the provider
owns its own callback route, so a `/callback` reached under that kind SHALL recover to `loginUrl`
rather than render a blank route or attempt an exchange.

#### Scenario: Callback exchanges the code and core restores the original URL
- **WHEN** the browser returns to `/callback?code=…&state=…` with a matching `state`
- **THEN** the provider callback exchanges the code, stores the token in memory, and the core navigates to the originally-requested URL with history replace

#### Scenario: State mismatch is rejected
- **WHEN** the `/callback` `state` does not match the value persisted before the redirect
- **THEN** no code exchange occurs and no token is stored

#### Scenario: Stray callback under a separate-view provider recovers
- **WHEN** `/callback` is reached while the active descriptor is the separate-view kind
- **THEN** core redirects to `loginUrl` rather than rendering a blank route or attempting an exchange

#### Scenario: Login config is reachable from an untrusted network
- **WHEN** an unauthenticated browser on a non-trusted network requests `GET /api/identity/login-config`
- **THEN** the network guard admits the request (public in-namespace path) and the route responds, rather than returning `403 network_not_allowed`

### Requirement: Login gate is loop-safe and return-to is same-origin

For the optional component adapter, the core SHALL run the login gate single-flight: at most one
*automatic* redirect to the issuer per page load, while ALWAYS exposing a manual sign-in affordance
(so a user is never stranded after an abandon or failure). If a freshly-acquired token is refused by
the host (e.g. audience/`azp`/clock-skew), the core SHALL clear the in-memory token and surface an
error state, and SHALL NOT automatically re-trigger the gate. A previously-valid token that reaches
expiry MAY trigger one automatic gate redirect (the re-acquire path). The core SHALL persist the PKCE
verifier, expected `state`, and return-to across the redirect. It SHALL validate the return-to by
resolving it against the current origin and accepting it only when the resolved origin equals the
current origin AND the resolved pathname is neither `/callback` nor `/auth/login`; any other value
SHALL default to `/`. These gate behaviors SHALL NOT be a requirement of an independent-frontend
deployment.

#### Scenario: A refused fresh token is cleared and does not loop
- **WHEN** the gate completes, acquires a token, and the host still refuses the connection
- **THEN** the client clears the in-memory token, shows an error with a manual sign-in affordance, and does not automatically redirect to the issuer again

#### Scenario: Scheme-relative and callback-recursion return-to are rejected
- **WHEN** the stashed return-to is an absolute URL, a scheme-relative `//host` value, `/callback`, or `/auth/login`
- **THEN** the core navigates to `/` instead of the rejected target

#### Scenario: Missing stashed state on callback lands safely
- **WHEN** `/callback` runs but the persisted verifier/state/return-to are absent (e.g. private mode or cross-origin landing)
- **THEN** no exchange occurs and the client renders the manual sign-in affordance on `/` without erroring or auto-redirecting

#### Scenario: IdP error response is handled
- **WHEN** the browser returns to `/callback?error=access_denied` (an IdP-declined authorization)
- **THEN** no code exchange occurs and the client shows a message with a link to `/`

#### Scenario: Callback with no trusted provider lands safely
- **WHEN** `/callback` runs but no trusted, active `login-provider` is mounted (the plugin was disabled or the trust list edited mid-flight)
- **THEN** the core renders a safe fallback (message + link to `/`) rather than a blank route or a crash
