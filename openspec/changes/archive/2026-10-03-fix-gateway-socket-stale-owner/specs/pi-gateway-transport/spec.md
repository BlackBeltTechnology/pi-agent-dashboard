## MODIFIED Requirements

### Requirement: Local bridge transport is platform-appropriate and protocol-identical
The dashboard SHALL accept local bridge connections over a unix domain socket on
POSIX platforms, and over a loopback-bound WebSocket on Windows. On POSIX, when
the local socket is unavailable, the dashboard SHALL accept local bridge
connections over its loopback fallback listener instead. Every transport SHALL
carry the existing WebSocket protocol unchanged, so that
`ExtensionToServerMessage`, `ServerToExtensionMessage`, WebSocket ping/pong
liveness, `terminate()`, and `readyState` semantics are preserved on any
transport.

#### Scenario: Bridge connects over the local socket on POSIX
- **WHEN** a pi session starts on a POSIX platform and a dashboard is listening on the HOME-derived socket path
- **THEN** the bridge SHALL connect over that socket
- **AND** it SHALL complete `session_register` without any TCP port being involved

#### Scenario: Bridge connects over the loopback fallback on POSIX
- **WHEN** a pi session is spawned by a POSIX dashboard that serves bridges on its loopback fallback listener
- **THEN** the bridge SHALL connect to that listener on `127.0.0.1`
- **AND** it SHALL complete `session_register` with the protocol unchanged

#### Scenario: Bridge connects over loopback on Windows
- **WHEN** a pi session starts on Windows
- **THEN** the bridge SHALL read the rendezvous record from the HOME-derived location and connect to the recorded port on `127.0.0.1`
- **AND** it SHALL complete `session_register` without consulting any network discovery mechanism

#### Scenario: Windows local listener stays on loopback
- **WHEN** the dashboard starts on Windows with a bind host other than `127.0.0.1` configured
- **THEN** the local bridge listener SHALL remain bound to `127.0.0.1`

#### Scenario: Contention probe still works over the socket
- **WHEN** the gateway probes an incumbent bridge connected over the local socket
- **THEN** a WebSocket `ping` SHALL elicit a `pong`
- **AND** the duplicate-registration decision SHALL behave identically to the TCP path

#### Scenario: Protocol is unchanged
- **WHEN** a bridge is connected over the local socket
- **THEN** every message type accepted on the TCP path SHALL be accepted unchanged
- **AND** no message SHALL require a transport-specific field


### Requirement: A stale local endpoint fails closed
Binding the local socket SHALL remove a pre-existing socket file at that path
**only** when it is established that nothing is listening on it and that the
dashboard that last bound the path is gone. That is established when the path
does not exist, or when the path is a socket that refuses connections AND the
dashboard that last bound it is provably gone — including when its process id
now belongs to an unrelated process. A refusal alone SHALL NOT suffice, because
on some platforms a saturated live listener also refuses. When it cannot be
established, the path SHALL NOT be removed (fail closed) and the dashboard SHALL
serve bridges on its loopback fallback listener instead. A file at the path that
is not a socket SHALL never be removed. A dashboard stopping SHALL remove only a
socket path it still owns. A client connecting to a path with no listener SHALL
fail immediately and definitively rather than establishing a connection to an
unintended server. Where the local endpoint is a port, a stale record SHALL be
rejected by identity verification rather than trusted.

#### Scenario: Concurrent binds on one path cannot interleave
- **WHEN** two instances attempt to bind the same socket path at the same time
- **THEN** the probe, removal and bind SHALL be serialized so that only one proceeds
- **AND** the other SHALL NOT remove a socket the first has bound

#### Scenario: A stopping dashboard never removes its successor's socket
- **WHEN** a dashboard is stopping while another dashboard reclaims and binds the same socket path
- **THEN** the stopping dashboard SHALL NOT remove the successor's socket
- **AND** bridges SHALL be able to connect to the successor

#### Scenario: An indeterminate probe fails closed
- **WHEN** probing an existing socket path cannot establish whether a listener is live
- **THEN** the path SHALL NOT be removed
- **AND** the dashboard SHALL serve bridges on its loopback fallback listener
- **AND** the refusal SHALL be logged with the occupied path and the reason

#### Scenario: A live socket is never unlinked
- **WHEN** a dashboard starts and its socket path already has a live listener
- **THEN** the path SHALL NOT be removed
- **AND** the existing listener SHALL remain bound and serving
- **AND** bridges connected to it SHALL NOT be disturbed
- **AND** the starting dashboard SHALL complete startup serving bridges on its loopback fallback listener
- **AND** the refusal SHALL be logged with the occupied path

#### Scenario: Fallback listener port unavailable aborts startup
- **WHEN** the socket bind is refused
- **AND** the loopback fallback port cannot be bound
- **THEN** startup SHALL abort with an error naming both the occupied socket path and the unavailable port
- **AND** the dashboard SHALL NOT keep running without a bridge listener

#### Scenario: A socket bind failure other than an occupied or unsupported path aborts startup
- **WHEN** the explicit TCP listener is not enabled
- **AND** binding the local socket fails for a reason other than the path being occupied or the filesystem not supporting unix sockets (for example a permission error or a held bind lock)
- **THEN** startup SHALL abort with an error naming the socket path and the cause
- **AND** no loopback fallback listener SHALL be bound

#### Scenario: With the explicit TCP listener a socket failure keeps TCP serving
- **WHEN** the explicit TCP listener is enabled
- **AND** binding the local socket fails for any reason
- **THEN** the failure SHALL be logged with the socket path and cause
- **AND** the explicit TCP listener SHALL keep serving bridges

#### Scenario: Sessions spawned after a fallback reach their spawner
- **WHEN** a dashboard serves bridges on its loopback fallback listener because another instance serves its socket path
- **AND** it spawns a session
- **THEN** that session's bridge SHALL register with the spawning dashboard, whichever launcher (direct, terminal multiplexer) started it
- **AND** SHALL NOT be directed to the other instance's socket path

#### Scenario: An abandoned socket file is cleaned up
- **WHEN** a dashboard starts and its socket path holds a socket with no listener
- **AND** the dashboard that last bound it is provably gone
- **THEN** the stale file SHALL be removed and the new listener bound

#### Scenario: A restart after a reboot reclaims the socket
- **WHEN** the host reboots while a dashboard is serving its socket path
- **AND** after the reboot the previous dashboard's process id belongs to an unrelated process, including the restarting dashboard itself
- **THEN** the restarting dashboard SHALL remove the stale socket and bind it without manual cleanup

#### Scenario: An unprovable abandoned socket fails closed
- **WHEN** the socket path holds a socket that refuses connections
- **AND** nothing proves that the dashboard that last bound the path is gone
- **THEN** the path SHALL NOT be removed
- **AND** the dashboard SHALL serve bridges on its loopback fallback listener

#### Scenario: A non-socket file is never removed
- **WHEN** a regular file, a symbolic link (dangling or not), or any other non-socket occupies the socket path
- **THEN** the file SHALL NOT be removed
- **AND** the dashboard SHALL serve bridges on its loopback fallback listener

#### Scenario: Stale Windows record pointing at a foreign listener is rejected
- **WHEN** the rendezvous record names a port now held by a different process or an unrelated dashboard
- **THEN** identity verification SHALL fail
- **AND** the bridge SHALL NOT register over that connection

#### Scenario: Leftover socket file is replaced on bind
- **WHEN** a dashboard starts and a socket file already exists at the target path with no listener and its last owner provably gone
- **THEN** the dashboard SHALL remove it and bind successfully

#### Scenario: Connecting to a dead socket errors immediately
- **WHEN** a bridge connects to a socket path whose server has exited
- **THEN** the connection attempt SHALL fail with a definitive error
- **AND** the bridge SHALL NOT be left connected to any other instance

### Requirement: The non-loopback bridge listener is opt-in
The dashboard SHALL NOT bind a non-loopback listener for bridge connections by
default. When one is enabled it SHALL accept only authenticated bridges. On
POSIX, a loopback bridge listener SHALL be bound by default only when the local
socket is unavailable — its path is unrepresentable, or its bind was refused
because the path is occupied.

#### Scenario: Default start binds no externally reachable bridge port
- **WHEN** the dashboard starts with default configuration on POSIX
- **AND** its local socket path is representable and its bind succeeds
- **THEN** it SHALL listen for bridges on the local socket only
- **AND** no bridge TCP port SHALL be bound

#### Scenario: Refused socket bind binds a loopback fallback only
- **WHEN** the dashboard starts with default configuration on POSIX
- **AND** its local socket bind is refused
- **THEN** its bridge listener SHALL be reachable only from `127.0.0.1`
- **AND** no externally reachable bridge port SHALL be bound

#### Scenario: Windows default start binds loopback only
- **WHEN** the dashboard starts with default configuration on Windows
- **THEN** its bridge listener SHALL be reachable only from `127.0.0.1`
- **AND** no externally reachable bridge port SHALL be bound

#### Scenario: Both transports can serve simultaneously
- **WHEN** the TCP listener is enabled
- **THEN** local socket bridges and authenticated TCP bridges SHALL both be able to register
- **AND** they SHALL share one connection-handling path

### Requirement: Endpoint selection is observable
Resolving, pinning, refusing, or changing a bridge endpoint SHALL be recorded
with the endpoint involved and the reason, on a channel that survives
`capturePiOutput=false`. The dashboard's own choice of bridge listener SHALL be
observable without reading its log.

#### Scenario: Selection is logged
- **WHEN** the bridge resolves its endpoint at startup
- **THEN** it SHALL log the chosen endpoint and which precedence rule selected it

#### Scenario: Refusal to migrate is logged
- **WHEN** a discovered candidate is rejected because the current endpoint is pinned
- **THEN** it SHALL log both endpoints and the reason for refusal

#### Scenario: A loopback fallback is visible in the health response
- **WHEN** the dashboard serves bridges on its loopback fallback listener
- **THEN** its health response SHALL report the bridge transport as the loopback fallback and the reason category (occupied or unsupported)
- **AND** it SHALL NOT include the socket path or any process id
