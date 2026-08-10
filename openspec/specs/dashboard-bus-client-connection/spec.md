# dashboard-bus-client-connection Specification

## Purpose
Establish and authenticate a headless client's WebSocket connection to the dashboard bus. A headless client cannot set an Authorization header on a WebSocket, so it discovers the dashboard host/port, mints a short-lived single-use ticket over REST, then opens the socket presenting only that ephemeral ticket and awaits the initial session snapshot before the connection is considered ready.

## Requirements

### Requirement: Dashboard host and port discovery
The client SHALL resolve the dashboard host and port from a fixed precedence of sources, falling back to defaults when no source supplies a value.

#### Scenario: Explicit port takes precedence
- **WHEN** a finite port number is passed explicitly to the client
- **THEN** that port is used and no other source is consulted

#### Scenario: Port from environment variable
- **WHEN** no explicit port is given and `DASHBOARD_PORT` is set to an all-digit value
- **THEN** the numeric value of `DASHBOARD_PORT` is used

#### Scenario: Port from config file
- **WHEN** no explicit port and no valid `DASHBOARD_PORT` are present
- **AND** `~/.pi/dashboard/config.json` contains a finite numeric `port` field
- **THEN** that `port` value is used

#### Scenario: Port default fallback
- **WHEN** no explicit port, no valid `DASHBOARD_PORT`, and no readable/valid config `port` are available
- **THEN** port `8000` is used

#### Scenario: Host resolution
- **WHEN** the host is resolved
- **THEN** an explicit host is used if given, otherwise `DASHBOARD_HOST` if set, otherwise `localhost`

### Requirement: Ticket-based authentication
The client SHALL obtain a single-use WebSocket ticket by issuing `POST /api/ws-ticket` to the resolved base URL, bound to a requested scope, before opening any socket.

#### Scenario: Successful mint
- **WHEN** the ticket endpoint responds with a success payload carrying a ticket value
- **THEN** a ticket is returned recording its value, mint time, a 15000 ms TTL, and the requested scope (default scope `browser`)

#### Scenario: Ticket is presented only as an ephemeral socket credential
- **WHEN** the client opens the socket after minting
- **THEN** it connects to `ws://<host>:<port>/ws?ticket=<value>` presenting only the ephemeral ticket, never the durable bearer

### Requirement: Off-box / untrusted mint rejection
The client SHALL surface an explicit `OffBoxError` (code `off-box`) whenever the ticket cannot be minted, rather than hanging.

#### Scenario: Network guard denies the caller
- **WHEN** the mint request returns HTTP 401 or 403
- **THEN** the client throws `OffBoxError`

#### Scenario: Mint endpoint unreachable
- **WHEN** the mint request fails to reach the base URL (fetch throws)
- **THEN** the client throws `OffBoxError` naming the unreachable base URL

#### Scenario: Mint response rejects the request
- **WHEN** the endpoint responds without a success flag or without a ticket value
- **THEN** the client throws `OffBoxError` carrying the server-reported reason

### Requirement: Connection readiness handshake
The client SHALL treat the connection as established only after the socket opens and the first `sessions_snapshot` message is received.

#### Scenario: Full connect flow
- **WHEN** `connect()` is called
- **THEN** the client discovers host/port, mints a `browser`-scoped ticket, opens the socket, and resolves after the initial `sessions_snapshot` arrives

#### Scenario: Ticket marked consumed on open
- **WHEN** the socket fires its `open` event
- **THEN** the ticket value is recorded as consumed so it cannot be reused for another connection

#### Scenario: Socket closes before ready
- **WHEN** the socket closes before the initial snapshot is received
- **THEN** pending waiters are failed with a `BusTimeoutError`

### Requirement: Distinct ticket failure errors
The client SHALL reject a connection attempt with a ticket-specific typed error, distinct from a generic socket close, when the presented ticket is locally expired or already consumed.

#### Scenario: Locally expired ticket
- **WHEN** `connectWithTicket` is called with a ticket whose TTL has elapsed against the client clock
- **THEN** it throws `TicketExpiredError` (code `ticket-expired`) and no socket is opened

#### Scenario: Reused single-use ticket
- **WHEN** `connectWithTicket` is called with a ticket value already recorded as consumed
- **THEN** it throws `TicketConsumedError` (code `ticket-consumed`) and no socket is opened

#### Scenario: Server rejects the ticket at upgrade
- **WHEN** the socket errors after open and the ticket is locally consumed or expired
- **THEN** the client rejects with the corresponding `TicketConsumedError` or `TicketExpiredError`, otherwise it propagates the underlying socket error
