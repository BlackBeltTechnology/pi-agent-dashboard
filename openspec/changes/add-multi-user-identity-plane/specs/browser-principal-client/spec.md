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
