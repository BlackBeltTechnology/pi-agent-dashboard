# pi-gateway-transport Specification

## Purpose
TBD - created by archiving change add-pi-gateway-transport-identity. Update Purpose after archive.
## Requirements
### Requirement: Local bridge transport is platform-appropriate and protocol-identical
The dashboard SHALL accept local bridge connections over a unix domain socket on
POSIX platforms, and over a loopback-bound WebSocket on Windows. Both SHALL
carry the existing WebSocket protocol unchanged, so that
`ExtensionToServerMessage`, `ServerToExtensionMessage`, WebSocket ping/pong
liveness, `terminate()`, and `readyState` semantics are preserved on either
transport.

#### Scenario: Bridge connects over the local socket on POSIX
- **WHEN** a pi session starts on a POSIX platform and a dashboard is listening on the HOME-derived socket path
- **THEN** the bridge SHALL connect over that socket
- **AND** it SHALL complete `session_register` without any TCP port being involved

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

### Requirement: The local endpoint is resolved from a HOME-derived rendezvous record
The local endpoint SHALL be resolved by reading a rendezvous record at a
home-directory-derived location, through the shared dashboard path helpers, with
no hostname lookup and no discovery input. The record SHALL name exactly one
instance, so resolution is a single deterministic read rather than a search.
The record and the socket SHALL be rooted at the same home directory.

#### Scenario: The rendezvous record is written by a running dashboard
- **WHEN** a dashboard instance starts and takes ownership of the HOME default
- **THEN** it SHALL write a rendezvous record naming its endpoint and its instance identity
- **AND** an unpinned bridge SHALL be able to resolve that endpoint by reading the record alone

#### Scenario: Socket path is per instance
- **WHEN** the local socket path is resolved on POSIX for an instance
- **THEN** the path SHALL be distinct per instance rather than shared across instances
- **AND** resolving it twice for the same instance SHALL yield the same path

#### Scenario: The instance identifier survives a restart
- **WHEN** a dashboard instance stops and starts again on the same gateway port
- **THEN** it SHALL present the same instance identifier as before
- **AND** a bridge registered with it SHALL reconnect without an identity mismatch

#### Scenario: A restart on a different gateway port is a different instance
- **WHEN** a dashboard instance restarts on a gateway port other than the one it previously used
- **THEN** it SHALL present a new instance identifier rather than reusing the previous one
- **AND** a bridge that is not explicitly pinned SHALL re-resolve its endpoint from the rendezvous record
- **AND** that bridge SHALL register with the instance the record names rather than refusing on the identifier change

#### Scenario: An unrelated process on a recorded endpoint cannot present the identifier
- **WHEN** the endpoint named by a stale record is occupied by a process that is not that dashboard
- **THEN** it SHALL be unable to present the recorded instance identifier
- **AND** the bridge SHALL refuse to register

#### Scenario: Two instances never both own the record
- **WHEN** two instances start concurrently and each observes the previous holder to be dead
- **THEN** exactly one SHALL end up owning the record
- **AND** the record SHALL name that owner
- **AND** neither SHALL delete a live lock or a record belonging to the other

#### Scenario: An unreadable record is not treated as absent
- **WHEN** the rendezvous record exists but cannot be read or parsed
- **THEN** ownership SHALL NOT be taken over on that basis
- **AND** the condition SHALL be reported distinctly from the record being absent

#### Scenario: A surviving instance promotes when the owner dies
- **WHEN** the instance owning the record exits without releasing it, and another instance under the same HOME is still running
- **THEN** the surviving instance SHALL take ownership and rewrite the record to name itself
- **AND** an unpinned bridge SHALL subsequently resolve to the surviving instance
- **AND** it SHALL NOT continue to resolve to the dead one

#### Scenario: A second same-HOME instance does not disturb the first
- **WHEN** a second dashboard starts under the same HOME on a different gateway port
- **THEN** it SHALL bind its own distinct endpoint
- **AND** it SHALL NOT overwrite the rendezvous record naming the first
- **AND** bridges already registered with the first SHALL remain connected to it

#### Scenario: Sessions spawned by a non-default instance reach their spawner
- **WHEN** a dashboard that does not own the HOME default spawns a session
- **THEN** that session's bridge SHALL connect to the spawning instance
- **AND** it SHALL NOT be redirected to the instance named by the rendezvous record

#### Scenario: Record and socket share one home root
- **WHEN** the home directory is overridden for an isolated run
- **THEN** the rendezvous record and the socket SHALL both resolve under that overridden home
- **AND** neither SHALL resolve under a different home than the other

#### Scenario: Windows resolves the port from the rendezvous record
- **WHEN** the local endpoint is resolved for a given HOME on Windows
- **THEN** the port SHALL be read from the rendezvous record under `<canonicalHome>/.pi/dashboard/`
- **AND** no multicast or hostname-based discovery SHALL be consulted

#### Scenario: Missing rendezvous record does not fall back to discovery
- **WHEN** no rendezvous record exists for the current HOME
- **THEN** endpoint resolution SHALL report that no local dashboard is available
- **AND** it SHALL NOT substitute a discovered candidate

#### Scenario: An unsupported socket path falls back rather than failing cryptically
- **WHEN** the resolved socket path cannot be used, because it exceeds the platform's socket path length limit or the filesystem does not support unix sockets
- **THEN** the condition SHALL be detected and reported in terms of the actual cause
- **AND** the local transport SHALL fall back to the loopback endpoint with local-credential authorisation
- **AND** it SHALL NOT fall back to network discovery

#### Scenario: Distinct HOMEs are isolated
- **WHEN** one dashboard runs under `HOME=/Users/x` and another under `HOME=/tmp/iso`
- **THEN** each SHALL bind its own socket
- **AND** a pi process SHALL connect to the dashboard matching its own inherited HOME
- **AND** neither bridge SHALL be able to reach the other instance by default

#### Scenario: Distinct HOMEs stay isolated on Windows
- **WHEN** two dashboards run under distinct HOME directories on Windows
- **THEN** each SHALL record its own rendezvous record under its own HOME
- **AND** a bridge SHALL resolve only the record belonging to its inherited HOME

### Requirement: Explicitly configured endpoints are pinned
An endpoint supplied by explicit configuration SHALL NOT be replaced by any
discovered candidate. Explicit configuration comprises `PI_DASHBOARD_SOCKET`,
`PI_DASHBOARD_URL`, and a configured instance identity, in that order of
precedence, ahead of the HOME-derived default and ahead of any discovery result.

#### Scenario: Discovery cannot override an explicit endpoint
- **WHEN** the bridge is configured with an explicit endpoint and a discovery mechanism reports a different server
- **THEN** the bridge SHALL retain the explicitly configured endpoint
- **AND** the discovered candidate SHALL be recorded as a suggestion only

#### Scenario: Pinned endpoint down fails visibly
- **WHEN** the bridge is configured with an explicit endpoint that is unreachable
- **THEN** the bridge SHALL keep retrying that endpoint
- **AND** it SHALL surface the failure
- **AND** it SHALL NOT silently connect to any other server

#### Scenario: Explicit socket overrides the HOME default
- **WHEN** `PI_DASHBOARD_SOCKET` is set to a path different from the HOME-derived one
- **THEN** the bridge SHALL use the configured path
- **AND** the HOME-derived path SHALL be ignored

### Requirement: A registered bridge sticks to its instance
Once a bridge has successfully registered with an instance, it SHALL reconnect
to that same instance. Re-targeting SHALL require that the current endpoint is
not pinned, that it has failed, and that the candidate's instance identity has
been verified.

#### Scenario: Reconnect returns to the same instance
- **WHEN** a registered bridge loses its connection and reconnects
- **THEN** it SHALL reconnect to the instance it was registered with

#### Scenario: Unverified candidate never displaces
- **WHEN** the current endpoint is unpinned and has failed, and a candidate is available whose instance identity cannot be verified
- **THEN** the bridge SHALL NOT re-target to that candidate

### Requirement: A session can be explicitly moved to another instance
An operator SHALL be able to move a running session's bridge to a named
instance. The move SHALL be a two-step handshake: the bridge first announces its
INTENT to the target, which claims nothing, and the session's routing SHALL
transfer only at an explicit commit. The bridge SHALL treat the resulting
endpoint as pinned and SHALL notify the origin that the session moved.

Announcing intent SHALL NOT be answered differently depending on whether the
target already knows the session, since a difference in answer would reveal
which sessions live on that instance.

#### Scenario: Move reaches the target before leaving the origin
- **WHEN** an operator moves a registered session to a reachable target instance
- **THEN** the bridge SHALL be connected to the target before closing the origin connection
- **AND** the session SHALL remain reachable throughout the move

#### Scenario: Routing transfers only at the commit
- **WHEN** a bridge has announced intent to the target but has not yet committed
- **THEN** the target SHALL NOT route that session to it
- **AND** any traffic it sends for that session before the commit SHALL NOT be delivered
- **AND** the origin SHALL remain the session's owner

#### Scenario: A commit moves only the session its authorisation names
- **WHEN** a commit names a different session than the one its authorisation was issued for
- **THEN** the commit SHALL be refused
- **AND** the named session's routing SHALL be unchanged

#### Scenario: A move never takes a session from a live owner
- **WHEN** a commit would displace a connection that is currently serving that session
- **THEN** the commit SHALL be refused
- **AND** the serving connection SHALL remain the owner
- **AND** the refusal SHALL NOT reveal why

#### Scenario: The origin is released only after the transfer is confirmed
- **WHEN** a bridge has sent a commit but the target has not confirmed the transfer
- **THEN** the bridge SHALL keep serving the session from the origin
- **AND** if the commit is refused or unanswered the move SHALL be abandoned with the origin still serving
- **AND** the origin SHALL NOT be told the session moved

#### Scenario: The origin reports the session as moved
- **WHEN** a move completes
- **THEN** the origin SHALL be told the session moved and to which instance identity
- **AND** the origin SHALL NOT present the session as crashed or unexpectedly disconnected

#### Scenario: A move pins the destination
- **WHEN** a move completes and the bridge later reconnects
- **THEN** it SHALL reconnect to the moved-to instance
- **AND** no discovered candidate SHALL displace it

#### Scenario: A move to an unverifiable target is refused
- **WHEN** an operator moves a session to a target whose instance identity cannot be verified
- **THEN** the move SHALL be refused
- **AND** the bridge SHALL remain registered with its current instance

#### Scenario: A move that would lose session history says so
- **WHEN** an operator moves a session to an instance that cannot read that session's transcript files
- **THEN** the operator SHALL be told that history and resume will not follow the move before it proceeds

#### Scenario: The current binding is inspectable
- **WHEN** an operator asks where a session is connected
- **THEN** the answer SHALL include the endpoint, the instance identity, and whether it is pinned

### Requirement: A stale local endpoint fails closed
Binding the local socket SHALL remove a pre-existing socket file at that path
**only** when no process is listening on it. A path with a live listener SHALL
abort startup with a conflict error rather than being unlinked and rebound. A
client connecting to a path with no listener SHALL fail immediately and
definitively rather than establishing a connection to an unintended server. Where
the local endpoint is a port, a stale record SHALL be rejected by identity
verification rather than trusted.

#### Scenario: Concurrent binds on one path cannot interleave
- **WHEN** two instances attempt to bind the same socket path at the same time
- **THEN** the probe, removal and bind SHALL be serialized so that only one proceeds
- **AND** the other SHALL abort with a conflict rather than removing a socket the first has bound

#### Scenario: An indeterminate probe fails closed
- **WHEN** probing an existing socket path cannot establish whether a listener is live
- **THEN** the path SHALL NOT be removed
- **AND** startup SHALL abort with a conflict

#### Scenario: A live socket is never unlinked
- **WHEN** a dashboard starts and its socket path already has a live listener
- **THEN** startup SHALL abort with a conflict error naming the occupied path
- **AND** the existing listener SHALL remain bound and serving
- **AND** bridges connected to it SHALL NOT be disturbed

#### Scenario: An abandoned socket file is cleaned up
- **WHEN** a dashboard starts and its socket path exists with no listener
- **THEN** the stale file SHALL be removed and the new listener bound

#### Scenario: Stale Windows record pointing at a foreign listener is rejected
- **WHEN** the rendezvous record names a port now held by a different process or an unrelated dashboard
- **THEN** identity verification SHALL fail
- **AND** the bridge SHALL NOT register over that connection

#### Scenario: Leftover socket file is replaced on bind
- **WHEN** a dashboard starts and a socket file already exists at the target path with no listener
- **THEN** the dashboard SHALL remove it and bind successfully

#### Scenario: Connecting to a dead socket errors immediately
- **WHEN** a bridge connects to a socket path whose server has exited
- **THEN** the connection attempt SHALL fail with a definitive error
- **AND** the bridge SHALL NOT be left connected to any other instance

### Requirement: The non-loopback bridge listener is opt-in
The dashboard SHALL NOT bind a non-loopback listener for bridge connections by
default. When one is enabled it SHALL accept only authenticated bridges.

#### Scenario: Default start binds no externally reachable bridge port
- **WHEN** the dashboard starts with default configuration on POSIX
- **THEN** it SHALL listen for bridges on the local socket only
- **AND** no bridge TCP port SHALL be bound

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
`capturePiOutput=false`.

#### Scenario: Selection is logged
- **WHEN** the bridge resolves its endpoint at startup
- **THEN** it SHALL log the chosen endpoint and which precedence rule selected it

#### Scenario: Refusal to migrate is logged
- **WHEN** a discovered candidate is rejected because the current endpoint is pinned
- **THEN** it SHALL log both endpoints and the reason for refusal

