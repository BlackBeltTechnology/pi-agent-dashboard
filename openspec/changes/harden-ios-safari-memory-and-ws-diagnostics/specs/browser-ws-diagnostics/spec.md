## Purpose

Makes the browser-facing WebSocket path diagnosable. It logs why and how browser sockets close, detects dead peers with a protocol-level keepalive, and records rejected upgrades, so client crashes, tunnel rejections and silent drops can be told apart from the server log alone.

## ADDED Requirements

### Requirement: Browser socket close is logged with code, reason, lifetime and frames
When a browser WebSocket closes, the server SHALL log one line containing the close code, the close reason (empty string when none), the connection lifetime in seconds, the number of inbound frames received, and the number of remaining browser clients.

#### Scenario: Abnormal closure is logged with code 1006
- **WHEN** a browser socket's underlying TCP connection is dropped without a close frame
- **THEN** the server logs a disconnect line containing `code=1006`, `reason=""`, a `lifetime=` value and a `frames=` value

#### Scenario: Normal closure carries the client's code and reason
- **WHEN** a browser client closes its socket with code `1000` and reason `"bye"`
- **THEN** the server logs a disconnect line containing `code=1000` and `reason="bye"`

### Requirement: Browser sockets have a protocol-level keepalive
The server SHALL send a WebSocket-level ping to every connected browser socket on a fixed interval. A socket that has not answered with a pong since the previous ping, for two consecutive intervals, SHALL be terminated, and the termination SHALL be logged with its cause. The keepalive timer SHALL be cleared when the browser gateway stops.

#### Scenario: Responsive client stays connected
- **WHEN** a browser socket answers every ping with a pong
- **THEN** the server never terminates it for keepalive reasons

#### Scenario: Unresponsive client is terminated and logged
- **WHEN** a browser socket answers no pings for two consecutive intervals
- **THEN** the server terminates the socket
- **AND** logs a line identifying the termination as a keepalive timeout

#### Scenario: Gateway stop clears the keepalive timer
- **WHEN** the browser gateway is stopped
- **THEN** no further pings are sent and no keepalive timer remains scheduled

### Requirement: Rejected WebSocket upgrades are logged without secrets
When the server rejects a WebSocket upgrade (400, 401 or 403), it SHALL log a line containing the HTTP status, the route scope, the socket peer address, the names of any proxy-forwarding headers present, and whether an auth ticket was present. The line SHALL NOT contain ticket values, cookie values, or forwarding-header values. Repeated rejections with the same status, scope and peer address SHALL be rate-limited to at most one line per 60 seconds, and the next emitted line SHALL report how many were suppressed.

#### Scenario: Tunnel-forwarded upgrade rejection is visible
- **WHEN** an upgrade to `/ws` from `127.0.0.1` carrying an `X-Forwarded-For` header is rejected with 403
- **THEN** the server logs a rejection line containing `403`, the `browser` scope, the peer address, and the header name `x-forwarded-for`
- **AND** the line does not contain the `X-Forwarded-For` header value

#### Scenario: Ticket value is never logged
- **WHEN** an upgrade carrying an invalid ticket is rejected
- **THEN** the rejection line reports that a ticket was present
- **AND** does not contain the ticket string

#### Scenario: Repeated rejections are rate-limited
- **WHEN** the same peer is rejected with the same status and scope 20 times within 60 seconds
- **THEN** at most one rejection line is logged in that window
- **AND** the next line logged after the window reports the suppressed count
