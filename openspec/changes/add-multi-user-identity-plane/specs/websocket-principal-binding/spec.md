## Purpose

Carries the resolved `(iss, sub)` principal and its credential expiry from a principal-bearing HTTP mint onto the browser WebSocket, makes an identity-bearing ticket mandatory for browser upgrades while the resolver is active so no other upgrade path bypasses it, and bounds an authenticated socket by its token expiry.

## ADDED Requirements

### Requirement: Ticket mint binds principal and expiry

The system SHALL bind the caller's resolved `principal` and `principalExpiresAt` onto the WebSocket ticket at mint time, in addition to route scope and optional device id. A ticket minted from a request with no principal SHALL carry no principal.

#### Scenario: Ticket minted for an authenticated human
- **WHEN** a request with a non-null `request.principal` mints a browser ws-ticket
- **THEN** the ticket records `(iss, sub)` and `expiresAt` alongside its scope
- **AND** the ticket remains single-use and short-TTL

#### Scenario: Ticket minted with no principal
- **WHEN** a request with `request.principal === null` mints a ticket
- **THEN** the ticket carries no principal

### Requirement: Browser upgrades require an identity ticket while the resolver is active

When the resolver is active, a browser-scope WebSocket upgrade SHALL require a valid single-use ticket minted by a principal-bearing request. Cookie, local-token, trusted-network, and no-ticket browser upgrades SHALL NOT bypass this requirement. Non-browser scopes (bridge, device/pairing) retain their existing, separately specified rules. While the resolver is inert, browser upgrades are unchanged from before this change.

#### Scenario: Cookie-only browser upgrade is refused when active
- **WHEN** a browser attempts an upgrade while the resolver is active with only a session cookie and no ticket
- **THEN** the upgrade is refused

#### Scenario: Trusted-network browser upgrade still requires a ticket
- **WHEN** a browser on a trusted network attempts an upgrade while the resolver is active without a ticket
- **THEN** the upgrade is refused

#### Scenario: Inert dashboard upgrades unchanged
- **WHEN** the resolver is inert and a browser upgrades as it does today
- **THEN** the upgrade succeeds exactly as before this change

### Requirement: Principal and expiry attached at upgrade

The system SHALL attach immutable `ws.principal` and `ws.principalExpiresAt` from the consumed ticket. After upgrade the socket SHALL expose its principal for the connection lifetime.

#### Scenario: Socket carries identity after 101
- **WHEN** a ticket bound to a principal is consumed at upgrade
- **THEN** `ws.principal` equals that principal and `ws.principalExpiresAt` equals the ticket expiry

#### Scenario: Principal-less ticket yields an anonymous socket
- **WHEN** a ticket with no principal is consumed
- **THEN** `ws.principal` is `null` and the socket is excluded from every principal-scoped delivery

### Requirement: Socket is bounded by token expiry

The system SHALL close a browser socket at `ws.principalExpiresAt`. Re-authentication SHALL occur by obtaining a fresh token, minting a new ticket, and reconnecting. The system SHALL NOT claim revocation before expiry; access-token TTL bounds the exposure.

#### Scenario: Socket closes at token expiry
- **WHEN** a socket's `principalExpiresAt` is reached
- **THEN** the socket is closed and its subscriptions released

### Requirement: Heartbeat detects transport liveness only

The system SHALL run a browser-plane heartbeat that terminates a socket failing to answer within the configured window, releasing its subscriptions. The heartbeat SHALL be transport-liveness only: it SHALL NOT extend, revalidate, or revoke the principal, and SHALL NOT be tied to any single session, since a browser socket multiplexes sessions. This is distinct from the bridge-plane ping/pong.

#### Scenario: Half-open browser socket is detected
- **WHEN** a browser socket stops answering the heartbeat within the window
- **THEN** the socket is terminated and its subscriptions released

#### Scenario: Heartbeat does not extend identity
- **WHEN** a socket answers heartbeats past `principalExpiresAt`
- **THEN** the socket is still closed at expiry, because liveness does not renew identity
