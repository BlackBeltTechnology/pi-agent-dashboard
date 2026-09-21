## Purpose

Makes the web client a public OIDC client for topology B: it acquires a Keycloak access token with Authorization Code + PKCE, holds it in memory, presents it as a bearer on REST calls, mints an identity-bearing WebSocket ticket, answers the transport heartbeat, and — when the realm issues sender-constrained tokens — attaches conditional DPoP proofs. All of this engages only when the dashboard's resolver is active; against an inert dashboard the client behaves exactly as before this change.

## ADDED Requirements

### Requirement: Public-client PKCE token acquisition

The client SHALL obtain a Keycloak access token via Authorization Code with PKCE as a public client (no client secret in the browser) and SHALL hold the access token in memory only (not `localStorage`), to limit token theft via XSS.

#### Scenario: Client completes a PKCE exchange
- **WHEN** an unauthenticated user opens the dashboard while the resolver is active
- **THEN** the client runs Authorization Code + PKCE and receives an access token
- **AND** the access token is held in memory, not persisted to `localStorage`

#### Scenario: No client secret is present in the browser
- **WHEN** the client performs the token exchange
- **THEN** it sends a PKCE code verifier and no client secret

### Requirement: Bearer attached to REST calls

The client SHALL attach `Authorization: Bearer <access-token>` to same-origin `/api` and `/v1` requests, distinct from the paired-device bearer, and SHALL NOT override an explicit `Authorization` header already set on a request.

#### Scenario: Human bearer rides same-origin API calls
- **WHEN** the client has an access token and issues a same-origin `/api` request
- **THEN** the request carries `Authorization: Bearer <access-token>`

#### Scenario: Explicit header is not overridden
- **WHEN** a request already sets its own `Authorization` header
- **THEN** the client does not replace it

### Requirement: Identity-bearing WebSocket ticket

The client SHALL mint a browser-scope WebSocket ticket using its bearer and SHALL present only `?ticket=` on the socket URL; the durable access token SHALL NOT ride the WebSocket.

#### Scenario: Unpaired human browser mints a ticket when active
- **WHEN** the resolver is active and an unpaired human browser (re)connects the WebSocket
- **THEN** the client mints a fresh single-use ticket via the bearer and presents only `?ticket=`
- **AND** the access token never appears on the WebSocket URL

### Requirement: Heartbeat reply and re-authentication

The client SHALL answer the browser transport heartbeat, and on a 401 or when the token reaches `principalExpiresAt` SHALL silently re-acquire a token and reconnect.

#### Scenario: Client reconnects on token expiry
- **WHEN** the socket closes at `principalExpiresAt`
- **THEN** the client re-acquires an access token, mints a new ticket, and reconnects

### Requirement: Conditional DPoP proofs

When the token endpoint returns a sender-constrained token (`cnf.jkt`), the client SHALL generate a non-extractable key, bind it at the token request, and attach a fresh DPoP proof per REST call and per ticket mint. When the token is not bound, the client SHALL omit proofs. The downgrade SHALL require no configuration.

#### Scenario: Bound token attaches proofs
- **WHEN** the realm issues a `cnf.jkt`-bound access token
- **THEN** the client sends a DPoP proof on each REST call and ticket mint

#### Scenario: Unbound token omits proofs
- **WHEN** the realm issues an unbound access token
- **THEN** the client sends no DPoP proof and REST calls still succeed

### Requirement: Inert dashboard leaves the client unchanged

When the dashboard's resolver is inert, the client SHALL NOT run PKCE, attach a human bearer, or mint an identity ticket; its behavior SHALL be identical to before this change.

#### Scenario: Client is inert against an inert dashboard
- **WHEN** the dashboard signals the identity plane is inert
- **THEN** the client behaves exactly as it did before this change (no PKCE, no bearer, no ticket)

### Requirement: Pre-auth browser login config

The host SHALL expose `GET /api/identity/login-config` reachable without authentication — via BOTH the auth-plugin bypass AND the universal network guard's public in-namespace path set — returning `{ active, issuer?, clientId? }`. The response SHALL be relayed from a descriptor the active trusted resolver's server plugin registered with the host (`registerBrowserLoginConfig`); core SHALL NOT read the resolver plugin's own config keys. `active` SHALL be true only when a trusted resolver is active AND has registered a dedicated `browserClientId`; the advertised `issuer` SHALL be a browser-reachable discovery base (`browserIssuer`, falling back to the validation `issuer`). Otherwise the response SHALL be `{ active: false }` with no issuer or client id disclosed.

#### Scenario: Active resolver with a browser client id advertises login
- **WHEN** the resolver is active and `authorizedParty` is configured
- **THEN** `GET /api/identity/login-config` returns `{ active: true, issuer, clientId }` without requiring authentication

#### Scenario: Inert or unconfigured resolver advertises no login
- **WHEN** the resolver is inert, or active without a configured browser client id
- **THEN** the endpoint returns `{ active: false }` and discloses no issuer or client id

### Requirement: Core-triggered login gate with plugin-owned OIDC

When the resolver is active and no live token is held, the client core SHALL stash the current URL as a return-to and invoke the single registered `login-provider` contribution's `startLogin(returnTo)`. The core SHALL NOT itself run OIDC discovery, PKCE, or token exchange; those SHALL be performed by the login-provider contribution. When no `login-provider` is registered, the core SHALL render no login gate.

#### Scenario: Active plane with no token starts the plugin login flow
- **WHEN** the resolver is active, the client holds no live token, and a `login-provider` is registered
- **THEN** the core stashes the current URL and calls the provider's `startLogin`, which redirects the browser to the issuer's authorize endpoint via PKCE

#### Scenario: No login provider means no gate
- **WHEN** the resolver is active but no `login-provider` contribution is registered
- **THEN** the core renders no login gate and does not attempt OIDC

### Requirement: Pre-auth callback mount and return-to restore

The core SHALL mount a pre-token `/callback` route (rendered before the authed shell) that renders the login-provider's callback component. The callback component SHALL verify the CSRF `state`, exchange the authorization code for a token, and write it to the in-memory token store. On success, the core — not the plugin — SHALL navigate to the stashed return-to URL. A `state` mismatch SHALL abort the exchange and store no token.

#### Scenario: Callback exchanges the code and core restores the original URL
- **WHEN** the browser returns to `/callback?code=…&state=…` with a matching `state`
- **THEN** the provider callback exchanges the code, stores the token in memory, and the core navigates to the originally-requested URL with history replace

#### Scenario: State mismatch is rejected
- **WHEN** the `/callback` `state` does not match the value issued at `startLogin`
- **THEN** no code exchange occurs and no token is stored

#### Scenario: Login config is reachable from an untrusted network
- **WHEN** an unauthenticated browser on a non-trusted network requests `GET /api/identity/login-config`
- **THEN** the network guard admits the request (public in-namespace path) and the route responds, rather than returning `403 network_not_allowed`

### Requirement: Login gate is loop-safe and return-to is same-origin

The core SHALL run the login gate single-flight: at most one *automatic* redirect to the issuer per page load, while ALWAYS exposing a manual sign-in affordance (so a user is never stranded after an abandon or failure). If a freshly-acquired token is refused by the host (e.g. audience/`azp`/clock-skew), the core SHALL clear the in-memory token and surface an error state, and SHALL NOT automatically re-trigger the gate. A previously-valid token that reaches expiry MAY trigger one automatic gate redirect (the re-acquire path). The core SHALL persist the PKCE verifier, expected `state`, and return-to across the redirect. It SHALL validate the return-to by resolving it against the current origin and accepting it only when the resolved origin equals the current origin AND the resolved pathname is neither `/callback` nor `/auth/login`; any other value SHALL default to `/`.

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
