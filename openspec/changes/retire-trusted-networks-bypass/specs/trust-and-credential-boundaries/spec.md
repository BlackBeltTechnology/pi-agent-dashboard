## MODIFIED Requirements

### Requirement: Browser device credential is not JS-readable
A browser whose API base is same-origin and that pairs SHALL exchange its paired-device bearer for an
httpOnly, `SameSite=Strict` cookie scoped to `path=/api/` that the server
accepts, on `/api/*` only, as a device credential with the same tier and
revocation as the bearer, and SHALL NOT keep the bearer in `localStorage`. The
exchange route SHALL be callable by a device of any tier. The cookie SHALL NOT
be sent on WebSocket upgrades. A client whose API base is cross-origin SHALL
keep the existing `Authorization: Bearer` behaviour unchanged. A bearer already stored in `localStorage` SHALL be
exchanged and removed on next load. WebSocket access SHALL continue to use
single-use tickets, with one exception: a `live`-scope upgrade MAY instead be
admitted by a live-preview capability path (see the `live-server-preview`
capability), which is short-lived, bound to one preview, never the durable
device credential, and never valid on core sockets (`/ws`, `/ws/terminal/*`,
`/ws/bridge`).

#### Scenario: pairing stores no bearer in localStorage
- **WHEN** a browser completes pairing
- **THEN** `localStorage` SHALL hold no bearer value and subsequent `/api/*` requests SHALL authenticate via the cookie

#### Scenario: legacy stored bearer migrated
- **WHEN** the client loads with a bearer under the legacy `localStorage` key
- **THEN** it SHALL be exchanged for the cookie and removed from `localStorage`

#### Scenario: revoked device cookie refused
- **WHEN** a paired device is revoked and its browser presents the device cookie
- **THEN** the request SHALL NOT be authenticated

#### Scenario: observe-tier device can exchange
- **WHEN** a paired device with tier `observe` posts its bearer to the exchange route
- **THEN** the cookie SHALL be set and requests SHALL keep tier `observe`

#### Scenario: cross-origin API base keeps the bearer
- **WHEN** the client's API base is on a different origin than the page
- **THEN** no exchange SHALL occur and REST + WS-ticket minting SHALL keep using `Authorization: Bearer`

#### Scenario: WS ticket minted via cookie
- **WHEN** a cookie-paired browser opens the WebSocket
- **THEN** it SHALL mint a single-use ticket using the cookie, and the durable credential SHALL NOT ride the socket

#### Scenario: live capability never opens a core socket
- **WHEN** a `/ws` upgrade presents a live-preview capability path or token
- **THEN** it SHALL NOT be admitted by it
