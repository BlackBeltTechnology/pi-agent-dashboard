# browser-ws-diagnostics Specification

## Purpose
Makes the browser-facing WebSocket path diagnosable. It logs why and how browser sockets close, detects dead peers with a protocol-level keepalive, and records upgrade rejections that are otherwise silent, so client crashes, tunnel rejections and silent drops can be told apart from the server log alone.

## Requirements

### Requirement: Browser socket close is logged with code, reason, lifetime, frames and cause
When a browser WebSocket closes, the server SHALL log exactly one line containing: the close code; the close reason decoded as UTF-8 and JSON-quoted (`""` when empty); the connection lifetime in seconds; the number of inbound frames received; the number of remaining browser clients; and a cause. The cause SHALL be `keepalive` when the server terminated the socket for a keepalive timeout, `stalled` when the server terminated it for exceeding the pending-send byte ceiling, and `peer` otherwise.

#### Scenario: Abnormal closure is logged with code 1006
- **WHEN** a browser socket's underlying TCP connection is dropped without a close frame
- **THEN** the server logs one disconnect line containing `code=1006`, `reason=""`, a `lifetime=` value, a `frames=` value and `cause=peer`

#### Scenario: Normal closure carries the client's code and reason
- **WHEN** a browser client closes its socket with code `1000` and reason `"bye"`
- **THEN** the server logs a disconnect line containing `code=1000` and `reason="bye"`

#### Scenario: Reason with quotes or newlines cannot break the line
- **WHEN** a browser client closes with a reason containing a double quote and a newline
- **THEN** the disconnect line is a single line, with the reason JSON-escaped

### Requirement: Browser sockets have a protocol-level keepalive
The server SHALL send a WebSocket-level ping to every connected browser socket on a fixed interval (default 30 seconds). Any pong SHALL reset the socket's missed-ping count. Because a ping is queued behind buffered data, any decrease of the socket's pending-send byte count since the previous interval, including a decrease to zero, SHALL also reset the missed-ping count. A socket that leaves two consecutive pings unanswered without such drain progress SHALL be terminated on the next interval, so a dead peer is detected within two to three intervals, and its close line SHALL carry `cause=keepalive`. The keepalive timer SHALL NOT keep the process alive on its own, and SHALL be cleared when the browser WebSocket server closes.

#### Scenario: Responsive client stays connected
- **WHEN** a browser socket answers every ping with a pong
- **THEN** the server never terminates it for keepalive reasons

#### Scenario: One missed ping is tolerated
- **WHEN** a browser socket leaves one ping unanswered and then answers the next
- **THEN** the socket stays connected

#### Scenario: Draining send buffer counts as liveness
- **WHEN** a browser socket answers no ping but its pending-send byte count decreases between intervals, including to zero
- **THEN** the server does not terminate it for keepalive reasons

#### Scenario: Unresponsive client is terminated with cause keepalive
- **WHEN** a browser socket leaves two consecutive pings unanswered
- **THEN** on the next interval the server terminates the socket
- **AND** logs exactly one disconnect line for it, containing `cause=keepalive`

#### Scenario: Server close clears the keepalive timer
- **WHEN** the browser WebSocket server is closed during shutdown
- **THEN** no further pings are sent and no keepalive timer remains scheduled

### Requirement: Silent WebSocket upgrade rejections are logged without secrets
When the server rejects a WebSocket upgrade with 400 (bridge scope on the dashboard port), 401 (auth configured, credentials invalid) or 403 (no auth configured, peer not admitted), and no other gate has already logged that rejection, it SHALL log a line containing the HTTP status, the route scope, the socket peer address, the names of any proxy-forwarding headers present, and whether an auth ticket was present. The line SHALL NOT contain ticket values, cookie values, or forwarding-header values. Detecting whether a ticket is present SHALL NOT consume the ticket. For each distinct status, scope and peer address, at most one line SHALL be logged per 60-second window. The first line logged for that key after its window SHALL report how many rejections were suppressed, unless the key's state was evicted to keep the rate-limit state bounded (at most 256 tracked keys).

#### Scenario: Tunnel-forwarded upgrade rejection is visible
- **WHEN** no auth secret is configured and an upgrade to `/ws` from `127.0.0.1` carrying an `X-Forwarded-For` header is rejected with 403
- **THEN** the server logs a rejection line containing `403`, the `browser` scope, the peer address, and the header name `x-forwarded-for`
- **AND** the line does not contain the `X-Forwarded-For` header value

#### Scenario: Ticket value is never logged
- **WHEN** an upgrade carrying an invalid ticket is rejected
- **THEN** the rejection line reports that a ticket was present
- **AND** does not contain the ticket string or any cookie value

#### Scenario: Repeated rejections are rate-limited
- **WHEN** the same peer is rejected with the same status and scope 20 times within 60 seconds
- **THEN** exactly one rejection line is logged in that window
- **AND** the first line for that key after the window reports 19 suppressed

#### Scenario: Rate-limit state stays bounded
- **WHEN** 1000 distinct peers are each rejected once
- **THEN** the rate-limit state tracks at most 256 keys

#### Scenario: Already-logged rejections are not double-logged
- **WHEN** an upgrade is refused by the host gate or the plugin/cross-origin gate, which already log their own rejection line
- **THEN** no additional rejection line from this requirement is emitted
