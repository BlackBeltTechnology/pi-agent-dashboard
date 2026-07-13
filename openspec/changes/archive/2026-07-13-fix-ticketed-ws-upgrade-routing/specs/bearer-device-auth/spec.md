## MODIFIED Requirements

### Requirement: WebSocket auth via single-use ticket before upgrade
A client SHALL obtain a short-lived, single-use WebSocket ticket from an
authenticated REST endpoint and present it when opening the socket. The server
SHALL refuse the upgrade unless the ticket validates, so no authenticated socket
exists before authentication (no TOCTOU). `Origin` validation against the CORS
allow-list SHALL be applied as defense-in-depth but SHALL NOT be the sole gate,
since absent-`Origin` requests exist. The durable bearer token SHALL NOT be placed
in the WebSocket URL, header, or logs; only the ephemeral ticket may ride the URL.

Once the upgrade is authorized (valid ticket, genuine-local origin, local-IPC
token, or trusted network), the server SHALL complete the upgrade by routing the
request to the correct WebSocket gateway based on the URL **path only**, ignoring
any query string. A ticket carried in the query (`/ws?ticket=<t>`) SHALL route
identically to a bare-path request (`/ws`); the presence of the ticket query
SHALL NOT cause the authorized socket to be destroyed instead of upgraded.

#### Scenario: No ticket, no upgrade
- **WHEN** a WebSocket upgrade is attempted without a valid single-use ticket
- **THEN** the server SHALL refuse the upgrade and no data SHALL be sent on the socket

#### Scenario: Ticket is single-use and short-lived
- **WHEN** a ticket is reused or presented after its short TTL
- **THEN** the upgrade SHALL be refused (ticket held in server memory, deleted synchronously on first upgrade attempt)

#### Scenario: Ticket bound to route scope
- **WHEN** a ticket minted for one WS route is presented against a different, more-privileged route (e.g. `/ws/terminal/*`)
- **THEN** the upgrade SHALL be refused

#### Scenario: No authenticated socket before auth
- **WHEN** a client opens a socket and withholds any further frames
- **THEN** because the ticket was validated at upgrade time, an unauthenticated socket is never admitted to receive broadcasts

#### Scenario: Validated ticketed upgrade completes on the browser route
- **WHEN** a client opens `/ws?ticket=<valid browser-scope ticket>` and the ticket validates
- **THEN** the server SHALL route the upgrade to the browser gateway and return `101 Switching Protocols`
- **AND** the server SHALL NOT destroy the socket merely because the URL carried a `?ticket=` query string

#### Scenario: Query string does not defeat path routing (no-auth branch)
- **WHEN** no OAuth secret is configured and a genuine-local or ticket-authorized client opens `/ws?ticket=<t>`
- **THEN** routing SHALL be decided on the path `/ws` (query stripped) and the upgrade SHALL complete, not fall through to a destroyed socket
