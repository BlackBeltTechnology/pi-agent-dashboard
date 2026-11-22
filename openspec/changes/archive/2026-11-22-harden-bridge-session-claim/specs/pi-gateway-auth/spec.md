## MODIFIED Requirements

### Requirement: Remote bridges authenticate as paired devices
A bridge connecting over a network transport SHALL authenticate using the
existing paired-device mechanism. It SHALL pair once to obtain a durable bearer
credential, and SHALL present a single-use, scope-bound ticket to open each
WebSocket connection. The durable bearer SHALL NOT be transmitted over the
WebSocket. A bridge ticket SHALL be minted for a paired device only when the
device's tier is `operate`, and the mint SHALL enforce this itself rather than
rely on the route's tier gate alone.

#### Scenario: Unauthenticated remote bridge is refused
- **WHEN** a bridge connects over the network transport without a valid ticket
- **THEN** the gateway SHALL refuse the connection
- **AND** the connection SHALL NOT be able to register any session id

#### Scenario: Paired bridge connects
- **WHEN** a bridge holding a valid device credential requests a ticket in the bridge scope and connects with it
- **THEN** the gateway SHALL accept the connection
- **AND** the bridge SHALL be able to register normally

#### Scenario: Ticket is single-use and scoped
- **WHEN** a bridge ticket is presented a second time, or is presented on a non-bridge WebSocket route
- **THEN** the gateway SHALL reject it

#### Scenario: Revoked device is locked out
- **WHEN** a bridge's paired device is revoked and the bridge attempts to reconnect
- **THEN** it SHALL fail to obtain a ticket
- **AND** it SHALL NOT be able to register

#### Scenario: A device below operate cannot mint a bridge ticket
- **WHEN** a device bearer of tier `observe` or `control` requests a ticket in the bridge scope
- **THEN** the request SHALL be refused with 403
- **AND** this SHALL hold even when the route tier gate exempted the request (trusted-network `legacy` mode)

#### Scenario: A below-operate refusal is logged
- **WHEN** a bridge-scope ticket request is refused because the bearer's tier is below `operate`
- **THEN** the server SHALL log `[auth] bridge ticket refused: tier=<tier> device=<8-char prefix>`, rate-limited per device with a 5_000 ms window
- **AND** the line SHALL carry neither the full device id nor the bearer

#### Scenario: Operate device mints as before
- **WHEN** a device bearer of tier `operate` requests a bridge-scope ticket
- **THEN** the ticket SHALL be minted carrying that device's id

#### Scenario: A below-operate bearer from a genuinely-local caller mints a deviceless ticket
- **WHEN** a request from a genuinely-local caller presents a device bearer of tier `observe`
- **AND** requests a bridge-scope ticket
- **THEN** the ticket SHALL be minted as for a bearer-less local caller, without that device's id
