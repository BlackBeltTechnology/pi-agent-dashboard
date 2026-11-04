## MODIFIED Requirements

### Requirement: A device bearer's tier gates REST routes and WS-ticket minting
Every `/api/*` route SHALL have a tier from a single route→tier map in
`packages/shared`; a route absent from the map SHALL require `operate`. A
request admitted via a paired-device bearer SHALL be refused with HTTP 403,
`WWW-Authenticate: Bearer error="insufficient_scope" scope="<tier>"` and a
logged refusal when the route's tier exceeds the row's tier. `/api/ws-ticket`
SHALL require `operate`. Principals admitted by other means (browser cookie
session, local token) SHALL see no change, and a bearer presented from a
genuinely local or trusted-network address SHALL NOT be tier-refused (that
network position is already fully trusted). The gate SHALL only refuse; it
SHALL NOT admit a request that existing admission rules reject.

When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

Routes under an enabled plugin public namespace (`/api/plugins/<id>/public/*`, see `plugin-public-routes`) SHALL be exempted from the device-bearer tier gate by an explicit namespace predicate evaluated before the map lookup; the map itself SHALL remain an exact lookup, and no new tier value SHALL be introduced. These routes never carry a device admission (the device branch does not run for them).

#### Scenario: Observe bearer cannot restart
- **WHEN** a request bearing an `observe` device token calls `POST /api/restart`
- **THEN** the server SHALL respond 403 with `WWW-Authenticate` containing `error="insufficient_scope"` and `scope="operate"`
- **AND** the restart handler SHALL NOT run

#### Scenario: Control bearer cannot mint a WS ticket
- **WHEN** a request bearing a `control` device token calls `POST /api/ws-ticket`
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Observe bearer reads within tier
- **WHEN** a request bearing an `observe` device token calls `GET /api/sessions`
- **THEN** the request SHALL be served

#### Scenario: Browser principal unchanged
- **WHEN** a request is admitted by a browser cookie session or the local token
- **THEN** no route SHALL be refused on tier grounds

#### Scenario: Loopback bearer is not tier-refused
- **WHEN** `requireLocalProof` is disabled and a request from a genuinely local address bears an `observe` device token and calls `POST /api/restart`
- **THEN** the request SHALL NOT be refused on tier grounds

#### Scenario: Unlisted route fails closed
- **WHEN** a route with no entry in the route→tier map is called with a `control` bearer
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Refusal is logged
- **WHEN** a tier refusal occurs
- **THEN** a log line SHALL record the device id, method, route pattern, principal tier and required tier

#### Scenario: Public namespace skips the tier gate; other plugin routes do not
- **WHEN** the tier gate evaluates `POST /api/plugins/web-chat/public/messages` and `GET /api/plugins/web-chat/config`
- **THEN** the first SHALL be skipped by the namespace predicate and the second SHALL resolve through the exact map (default `operate`) as before

### Requirement: Bearer auth branch for REST
The server SHALL accept a valid bearer token via `Authorization: Bearer`, or via
the httpOnly `SameSite=Strict` device cookie a same-origin browser obtains by
exchanging its bearer (`POST /api/device-session`, cookie scoped to `path=/api/`), as an authentication source feeding the existing `request.isAuthenticated` decision,
WITHOUT altering the loopback, trusted-network, or OAuth cookie paths. A request
admitted by the device cookie SHALL carry the same `authVia = "device"` marker
and tier as the bearer, and revoking the device SHALL invalidate both. The durable
bearer token authenticates REST only; WebSocket upgrades authenticate via a
short-lived single-use ticket (see "WebSocket auth via single-use ticket before
upgrade") and the durable bearer SHALL NOT ride the socket.

The bearer branch SHALL NOT run for a request under an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`): such a request is never authenticated by a device bearer or device cookie, and an invalid, revoked or unknown device bearer there SHALL NOT produce `401` from this branch.

#### Scenario: REST request authorized by bearer
- **WHEN** a cross-origin REST request presents a valid bearer token
- **THEN** the request is marked authenticated and served

#### Scenario: WebSocket authorized via ticket, not durable bearer
- **WHEN** a client needs a WebSocket to a paired server
- **THEN** it mints a single-use ticket from an authenticated REST call and presents that ticket on the upgrade, never the durable bearer token

#### Scenario: Existing paths unaffected
- **WHEN** `requireLocalProof` is disabled and a user relies only on loopback or the OAuth cookie
- **THEN** authentication behaves exactly as before this change

#### Scenario: Invalid bearer rejected
- **WHEN** a request presents an unknown or revoked bearer token and matches no other allow path
- **THEN** the server responds 401

#### Scenario: Device cookie authenticates like the bearer

- **WHEN** a same-origin browser presents a valid device cookie and no `Authorization` header
- **THEN** the request is marked authenticated with `authVia = "device"` and the device's tier

#### Scenario: Revoked device cookie rejected

- **WHEN** a request presents the device cookie of a revoked device and matches no other allow path
- **THEN** the server responds 401

#### Scenario: Device bearer ignored on a public namespace
- **WHEN** a request to an enabled plugin public route carries a valid, a revoked, or an unknown device bearer
- **THEN** the bearer branch SHALL NOT authenticate or refuse it
