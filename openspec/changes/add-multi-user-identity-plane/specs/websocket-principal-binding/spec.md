## Purpose

Carries the resolved `(iss, sub)` principal from the HTTP ticket mint onto the WebSocket connection so the socket is no longer anonymous, and keeps an authenticated socket from outliving its principal's validity on the browser plane.

## ADDED Requirements

### Requirement: Ticket mint binds the principal

The system SHALL bind the caller's resolved `principal` onto the WebSocket ticket at mint time, in addition to the existing route scope and optional device id. A ticket minted without a resolved principal SHALL carry no principal.

#### Scenario: Ticket minted for an authenticated human
- **WHEN** a request with a non-null `request.principal` mints a ws-ticket
- **THEN** the ticket records the `(iss, sub)` principal alongside its route scope
- **AND** the ticket remains single-use and short-TTL as before

#### Scenario: Ticket minted with no principal
- **WHEN** a request with `request.principal === null` mints a ws-ticket (e.g. a device bearer or bypass path)
- **THEN** the ticket carries no principal
- **AND** any socket it upgrades is treated as principal-less

### Requirement: Principal attached at upgrade

The system SHALL attach `ws.principal` to the socket when the ticket is consumed at the WebSocket upgrade, from the principal recorded on the ticket. After upgrade the socket SHALL expose its principal for the lifetime of the connection.

#### Scenario: Socket carries identity after 101
- **WHEN** a ticket bound to a principal is consumed at upgrade
- **THEN** `ws.principal` equals that principal for the connection's lifetime

#### Scenario: Principal-less ticket yields an anonymous socket
- **WHEN** a ticket with no principal is consumed at upgrade
- **THEN** `ws.principal` is `null`
- **AND** the socket is excluded from every principal-scoped delivery

### Requirement: Browser-plane liveness bounds an authenticated socket

The system SHALL run a heartbeat on the browser WebSocket plane and SHALL close a browser socket when its underlying session ends, so that an authenticated socket cannot stream indefinitely after its principal should no longer be served. This is distinct from the bridge-plane ping/pong.

#### Scenario: Half-open browser socket is detected
- **WHEN** a browser socket stops answering the browser-plane heartbeat within the configured window
- **THEN** the socket is terminated and its subscriptions released

#### Scenario: Socket closes when its session ends
- **WHEN** the session a browser socket is bound to ends
- **THEN** the socket is closed rather than left streaming
