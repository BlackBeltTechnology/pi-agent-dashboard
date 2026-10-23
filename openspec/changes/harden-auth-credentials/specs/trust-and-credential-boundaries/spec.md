## MODIFIED Requirements

### Requirement: Browser device credential is not JS-readable
A browser whose API base is same-origin and that pairs SHALL exchange its paired-device bearer for an
httpOnly, `SameSite=Strict` cookie scoped to `path=/api/` that the server
accepts, on `/api/*` only, as a device credential with the same tier and
revocation as the bearer, and SHALL NOT keep the bearer in `localStorage`. The
exchange route SHALL be callable by a device of any tier. The cookie SHALL NOT
be sent on WebSocket upgrades. A client whose API base is cross-origin SHALL
keep authenticating with `Authorization: Bearer`, but the bearer it holds SHALL be short-lived and rotated (see `bearer-device-auth`), SHALL be kept in a slot specific to that API origin, and SHALL NOT be a non-expiring credential in `localStorage`. The legacy single global bearer slot (`pi-dashboard:device-bearer`) SHALL be discarded on load whatever the API base is: never exchanged for the cookie, never sent to any server, and never migrated into a per-origin slot. A same-origin browser that finds only that legacy slot re-pairs once and then obtains the cookie by pairing. A same-origin browser that cannot keep the cookie SHALL keep its bearer (see `bearer-device-auth`, "Browser keeps its bearer until the cookie is proven") in the per-origin slot for its own origin, never the legacy global slot; that bearer is non-expiring until the cookie is proven, a documented residual, and is not a reason to exchange the legacy slot. WebSocket access SHALL continue to use
single-use tickets, with one exception: a `live`-scope upgrade MAY instead be
admitted by a live-preview capability path (see the `live-server-preview`
capability), which is short-lived, bound to one preview, never the durable
device credential, and never valid on core sockets (`/ws`, `/ws/terminal/*`,
`/ws/bridge`).

#### Scenario: pairing stores no bearer in localStorage
- **WHEN** a browser completes pairing
- **THEN** `localStorage` SHALL hold no bearer value and subsequent `/api/*` requests SHALL authenticate via the cookie

#### Scenario: legacy stored bearer migrated
- **WHEN** the client loads, with a same-origin or a cross-origin API base, with a bearer under the legacy global `localStorage` key
- **THEN** the legacy value SHALL be removed from `localStorage` without being exchanged for the cookie or sent to any server
- **AND** the user SHALL re-pair once, after which a same-origin browser authenticates by the cookie

#### Scenario: revoked device cookie refused
- **WHEN** a paired device is revoked and its browser presents the device cookie
- **THEN** the request SHALL NOT be authenticated

#### Scenario: observe-tier device can exchange
- **WHEN** a paired device with tier `observe` posts its bearer to the exchange route
- **THEN** the cookie SHALL be set and requests SHALL keep tier `observe`

#### Scenario: cross-origin API base keeps the bearer
- **WHEN** the client's API base is on a different origin than the page
- **THEN** no exchange SHALL occur, REST + WS-ticket minting SHALL use `Authorization: Bearer`, and the stored bearer SHALL carry a server-enforced expiry

#### Scenario: legacy global slot is not copied for a cross-origin base
- **WHEN** the client loads with a bearer under the legacy global `localStorage` slot and its API base is cross-origin
- **THEN** the legacy bearer SHALL NOT be copied into a per-origin slot
- **AND** the user SHALL re-pair once with that server

#### Scenario: same-origin keep-failed bearer is kept per origin
- **WHEN** a same-origin browser pairs, the cookie exchange succeeds but the cookie-only check fails
- **THEN** the browser SHALL keep its bearer in the slot for its own origin, keep authenticating with it, and SHALL NOT write it to the legacy global slot

#### Scenario: cross-origin bearers are kept per API origin
- **WHEN** the client has paired with two different cross-origin API bases
- **THEN** each base's bearer SHALL be stored separately and SHALL NOT be sent to, or overwritten by, the other origin

#### Scenario: WS ticket minted via cookie
- **WHEN** a cookie-paired browser opens the WebSocket
- **THEN** it SHALL mint a single-use ticket using the cookie, and the durable credential SHALL NOT ride the socket

#### Scenario: live capability never opens a core socket
- **WHEN** a `/ws` upgrade presents a live-preview capability path or token
- **THEN** it SHALL NOT be admitted by it

## ADDED Requirements

### Requirement: Auth-relevant mutations leave an audit line
The server SHALL write one audit log line for each of: paired-device revoke, direct device-token mint, bearer rotation, provider credential write or delete (API-key PUT, provider DELETE, flow value input), Radius MCP configure, and OAuth flow start. A line SHALL carry the event name, the device id prefix or actor, and the socket-peer IP where a request exists. A line SHALL NEVER contain a token, key, secret, code or submitted value.

#### Scenario: Device revoke is logged
- **WHEN** an operator revokes a paired device
- **THEN** a line naming the revoke event, the first 8 characters of the device id, the actor and the peer IP SHALL be logged
- **AND** the line SHALL NOT contain the bearer or its hash

#### Scenario: Token mint and rotation are logged
- **WHEN** a device token is minted directly, or a browser bearer is rotated
- **THEN** a line naming the event, the device id prefix and the peer IP SHALL be logged without any token value

#### Scenario: Provider credential write and delete are logged
- **WHEN** a provider API key is stored or a provider credential is deleted
- **THEN** a line naming the event and provider, the actor and the peer IP SHALL be logged
- **AND** the line SHALL NOT contain the key

#### Scenario: Flow value input is logged without the value
- **WHEN** a value is submitted to `POST /api/provider-auth/flow/:flowId/input` (an authorization code or a redirect URL carrying one)
- **THEN** a line naming the event, the flow id prefix, the actor and the peer IP SHALL be logged
- **AND** the line SHALL NOT contain the submitted value

#### Scenario: Radius MCP configure is logged
- **WHEN** `POST /api/provider-auth/radius/mcp` writes the Radius MCP server entry that routes the Radius credential
- **THEN** a line naming the event, the actor and the peer IP SHALL be logged without any header or credential content

#### Scenario: OAuth start is logged with the request IP
- **WHEN** a provider OAuth flow is started
- **THEN** a line naming the event, the provider, the actor and the requesting peer IP SHALL be logged

#### Scenario: Peer IP is the socket peer only
- **WHEN** a request arrives through a tunnel or carries forwarding headers
- **THEN** the logged IP SHALL be the socket peer address (loopback for tunnel traffic) and SHALL NOT be taken from any forwarding header

#### Scenario: System writers are attributed
- **WHEN** a credential is written by a system process (legacy migration or token refresh) rather than a request
- **THEN** the actor SHALL be recorded as `system` and no IP SHALL be required

#### Scenario: Pairing decision lines keep their format
- **WHEN** a pairing request is approved, denied, locked out or expires
- **THEN** the existing `[pairing] <verb> id=<8>` line SHALL be emitted unchanged, with no IP required, because the pairing core has no request context

### Requirement: Audit values are sanitized and refusals are audited
Every value written to an audit line SHALL have each character outside `[\w.:-]` replaced with `_`; a device id prefix SHALL be taken after sanitizing. A refused bearer rotation of a known device SHALL be audited as `[pairing] rotate_refused id=<8> reason=<code> ip=<ip>`. A revoke of an unknown id SHALL NOT be audited. A failure to write an audit line SHALL NOT fail the mutation.

#### Scenario: Control characters cannot forge a line
- **WHEN** an audited value contains a newline, space or other character outside `[\w.:-]`
- **THEN** each such character SHALL appear as `_` and the entry SHALL stay on one line

#### Scenario: Refused rotation is audited
- **WHEN** a rotation of a known device is refused (expired, superseded, rate limited or failed)
- **THEN** a line `[pairing] rotate_refused id=<8> reason=<code> ip=<ip>` SHALL be logged with the refusal's error code and no token

#### Scenario: Unknown-id revoke is not audited
- **WHEN** a revoke targets an id absent from the registry
- **THEN** no audit line SHALL be written for it

#### Scenario: Audit write failure fails open
- **WHEN** the audit line cannot be written during a mutation
- **THEN** the mutation SHALL still complete
