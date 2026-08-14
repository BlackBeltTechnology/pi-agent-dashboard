## ADDED Requirements

### Requirement: Local bridge authorisation restricts access to the owning user
A bridge connecting over the local endpoint SHALL be authorised such that only
the owning operating system user can connect. On POSIX this SHALL be enforced by
ownership of the socket, and no additional token SHALL be required. On Windows,
where filesystem modes do not apply, it SHALL be enforced by a local credential
readable only by the owning user.

#### Scenario: Socket is owner-only on POSIX
- **WHEN** the dashboard binds the local bridge socket
- **THEN** the socket SHALL have mode `0600`
- **AND** its containing directory SHALL have mode `0700`

#### Scenario: Another user cannot connect on POSIX
- **WHEN** a process running as a different user attempts to connect to the socket
- **THEN** the connection SHALL be refused by the operating system

#### Scenario: Windows local bridge presents the local token
- **WHEN** a bridge connects to the loopback bridge listener on Windows
- **THEN** it SHALL present the local token credential read from the HOME-derived location
- **AND** the server SHALL verify it with a constant-time comparison

#### Scenario: Windows local bridge without the token is refused
- **WHEN** a process connects to the loopback bridge listener without a valid local token
- **THEN** the connection SHALL be refused
- **AND** it SHALL NOT be able to register any session id

#### Scenario: Local credential is not readable by other users
- **WHEN** the local token file is created
- **THEN** it SHALL be readable only by the owning operating system user
- **AND** on platforms where filesystem modes are not enforced, the guarantee SHALL be verified against the platform's own access control rather than assumed from the requested mode

### Requirement: A local bridge verifies the instance identity, not just the credential
The local credential answers whether a client may connect; it SHALL NOT be
treated as evidence of *which* instance answered. A bridge SHALL verify that the
instance it reached is the one the rendezvous record named, because the local
credential is shared by every dashboard running under the same home directory.

#### Scenario: A different instance holding the recorded port is rejected
- **WHEN** a bridge dials the endpoint named by the rendezvous record and reaches a dashboard whose identity differs from the recorded one
- **THEN** the bridge SHALL refuse to register
- **AND** it SHALL report an identity mismatch rather than a connection failure
- **AND** presenting a valid local credential SHALL NOT bypass this check

#### Scenario: A rebound socket path is detected
- **WHEN** a bridge reconnects to its socket path and a different instance now serves it
- **THEN** the bridge SHALL detect the identity change and refuse to register

#### Scenario: The matching instance is accepted
- **WHEN** a bridge reaches the instance whose identity matches the record
- **THEN** registration SHALL proceed

### Requirement: Remote bridges authenticate as paired devices
A bridge connecting over a network transport SHALL authenticate using the
existing paired-device mechanism. It SHALL pair once to obtain a durable bearer
credential, and SHALL present a single-use, scope-bound ticket to open each
WebSocket connection. The durable bearer SHALL NOT be transmitted over the
WebSocket.

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

### Requirement: A remote bridge pins the server identity
A bridge that pairs with a remote dashboard SHALL record that server's public
key fingerprint and SHALL verify possession of the corresponding private key
before registering. A server that cannot prove possession of the pinned identity
SHALL be refused, regardless of what address or name it presents.

#### Scenario: Fingerprint recorded at pairing
- **WHEN** a bridge completes pairing with a remote dashboard
- **THEN** it SHALL persist that dashboard's public key fingerprint

#### Scenario: Impostor is refused
- **WHEN** a bridge connects to an endpoint whose server cannot answer the nonce challenge for the pinned fingerprint
- **THEN** the bridge SHALL refuse to register
- **AND** it SHALL report an identity mismatch

#### Scenario: Identity survives an address change
- **WHEN** a paired remote dashboard becomes reachable at a different address while retaining its keypair
- **THEN** a bridge presented with that endpoint SHALL accept it once the challenge succeeds
- **AND** the pinned fingerprint SHALL NOT need to be re-established

### Requirement: Authentication outcomes are observable
Refusing a bridge connection SHALL be recorded with the reason and the transport
involved, distinguishing an unauthenticated attempt, an invalid or reused
ticket, a revoked device, and an identity mismatch.

#### Scenario: Refusal reason is distinguishable
- **WHEN** a bridge connection is refused
- **THEN** the log record SHALL identify which of the refusal causes applied
- **AND** it SHALL NOT report a generic connection error
