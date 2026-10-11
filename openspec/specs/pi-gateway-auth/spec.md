# pi-gateway-auth Specification

## Purpose
TBD - created by archiving change add-pi-gateway-transport-identity. Update Purpose after archive.

## Requirements

### Requirement: Local bridge authorisation restricts access to the owning user
A bridge connecting over the local endpoint SHALL be authorised such that only
the owning operating system user can connect. On POSIX, over the local socket,
this SHALL be enforced by ownership of the socket, and no additional credential
SHALL be required. On Windows, where filesystem modes do not apply, it SHALL be
enforced by a local credential readable only by the owning user, and that
restriction SHALL be established by an OBSERVED read attempt rather than by
inspecting the access control list alone. Over a loopback TCP dial the bridge
SHALL prove possession of the local credential (a local credential proof) and
SHALL NOT transmit the credential itself. On POSIX, when the loopback fallback
listener serves because the local socket bind was refused, every bridge SHALL
present a valid local credential proof, the legacy raw local token while the
legacy window is open, or a bridge ticket; no tokenless bridge SHALL be accepted
there.

#### Scenario: Socket is owner-only on POSIX
- **WHEN** the dashboard binds the local bridge socket
- **THEN** the socket SHALL have mode `0600`
- **AND** its containing directory SHALL have mode `0700`

#### Scenario: Another user cannot connect on POSIX
- **WHEN** a process running as a different user attempts to connect to the socket
- **THEN** the connection SHALL be refused by the operating system

#### Scenario: POSIX fallback listener requires the local token
- **WHEN** a dashboard on POSIX serves bridges on its loopback fallback listener
- **AND** a process connects to it with no valid local credential proof, no accepted legacy local token and no valid bridge ticket
- **THEN** the connection SHALL be refused
- **AND** it SHALL NOT be able to register any session id

#### Scenario: POSIX fallback bridge presents the local token
- **WHEN** a bridge of the owning user connects to the loopback fallback listener
- **THEN** it SHALL present a local credential proof in the `X-Pi-Local-Proof` header
- **AND** it SHALL NOT send the `X-Pi-Local-Token` header
- **AND** it SHALL be able to register

#### Scenario: Windows local bridge presents the local token
- **WHEN** a bridge connects to the loopback bridge listener on Windows
- **THEN** it SHALL present a local credential proof in the `X-Pi-Local-Proof` header
- **AND** the proof SHALL be derived from the credential read at the HOME-derived location
- **AND** the server SHALL verify the proof's MAC with a constant-time comparison

#### Scenario: Windows local bridge without the token is refused
- **WHEN** a process connects to a loopback bridge listener that grants no tokenless grace
- **AND** it presents neither a valid local credential proof nor an accepted legacy local token nor a valid bridge ticket
- **THEN** the connection SHALL be refused
- **AND** it SHALL NOT be able to register any session id

#### Scenario: Local credential is not readable by other users
- **WHEN** the local token file is created
- **THEN** it SHALL be readable only by the owning operating system user
- **AND** on platforms where filesystem modes are not enforced, the guarantee SHALL be verified against the platform's own access control rather than assumed from the requested mode

#### Scenario: A second Windows user is refused the credential by the OS
- **WHEN** a second standard (non-administrator) OS user attempts to read
  `~/.pi/dashboard/local/token`, `identity.key`, or `paired-devices.json`
- **THEN** the read SHALL be denied by the operating system
- **AND** the denial SHALL be recorded from an actual read attempt, since an
  access control list that merely names no broad principal describes
  configuration rather than enforced behaviour

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
ticket, a revoked device, an identity mismatch, an invalid local credential
proof (with its sub-cause), and a missing or invalid server counter-proof.
Accepting a bridge on the legacy raw local token SHALL be recorded as
deprecated.

#### Scenario: Refusal reason is distinguishable
- **WHEN** a bridge connection is refused
- **THEN** the log record SHALL identify which of the refusal causes applied
- **AND** it SHALL NOT report a generic connection error

#### Scenario: Invalid proof sub-cause is recorded
- **WHEN** the server rejects a local credential proof
- **THEN** the server log SHALL name the sub-cause: malformed, stale, before-start, binding-mismatch, bad-mac, replayed, or replay-cache-full
- **AND** the response to the client SHALL NOT reveal the sub-cause

#### Scenario: Legacy token acceptance is recorded
- **WHEN** a bridge is admitted on the raw `X-Pi-Local-Token` header
- **THEN** the server SHALL log the admission as deprecated
- **AND** it SHALL emit at most one such line per caller kind per 60 seconds, the next emitted line carrying the number of admissions suppressed since the previous line

### Requirement: Local credential proofs are endpoint-bound, fresh and single-use
A local credential proof SHALL be a MAC, keyed by a key derived from the local
token, over the dialled endpoint binding (an address literal and port, never a
host name), a millisecond timestamp, a random nonce, and the purpose of the
request. The server SHALL accept a proof only when its binding equals the
canonical local address and port on which the connection actually arrived, its
timestamp lies within the freshness window (30 seconds) on either side of the server's clock, its
timestamp is not earlier than
the moment the listener it arrived on began listening, its MAC verifies, and its
nonce has not been accepted before while the timestamp could still be fresh.
The replay check SHALL run only after the MAC verifies. A proof that is relayed
to another endpoint SHALL NOT earn a credentialed admission; any admission it
still receives is the tokenless grace the listener grants to every loopback
peer.

#### Scenario: Proof relayed to another endpoint is rejected
- **WHEN** a process holding `127.0.0.1:<port>` forwards a bridge's upgrade to the genuine dashboard's TCP listener at a different address or port (including `[::1]`)
- **THEN** the dashboard SHALL reject the proof as a binding mismatch
- **AND** it SHALL NOT emit a server counter-proof for that request

#### Scenario: Captured proof replayed to the same endpoint is rejected
- **WHEN** a proof that was already accepted is presented again within the replay horizon
- **THEN** the server SHALL reject it as replayed

#### Scenario: Proof captured before the listener bound is rejected
- **WHEN** a proof whose timestamp precedes the moment the receiving listener began listening is presented
- **THEN** the server SHALL reject it as before-start
- **AND** this SHALL hold even though a restarted server's replay cache is empty

#### Scenario: Future-dated proof is rejected
- **WHEN** a proof's timestamp is ahead of the server's clock by more than the freshness window
- **THEN** the server SHALL reject it as stale

#### Scenario: Stale proof is rejected
- **WHEN** a proof's timestamp is older than the freshness window
- **THEN** the server SHALL reject it as stale

#### Scenario: Each dial carries a fresh proof
- **WHEN** a bridge reconnects to the same endpoint
- **THEN** each dial SHALL carry a proof with a new nonce and timestamp
- **AND** no proof SHALL be presented twice

#### Scenario: Name-addressed loopback dial is bound to the address reached
- **WHEN** a bridge's endpoint names a loopback host (for example `localhost`)
- **THEN** the bridge SHALL resolve and connect exactly as it would without a proof
- **AND** it SHALL bind the proof to the address literal and port of the connection it established

#### Scenario: Unbounded proof input is rejected
- **WHEN** a proof's nonce or timestamp falls outside the bounded length and character set
- **THEN** the server SHALL reject it as malformed before computing any MAC

#### Scenario: Replay cache overflow fails closed
- **WHEN** the replay cache is full of unexpired nonces
- **THEN** the server SHALL reject further proofs rather than evict an unexpired nonce

### Requirement: A presented-but-invalid local credential proof is treated as absent
A bridge upgrade carrying a local credential proof that fails verification SHALL
be treated exactly as an upgrade carrying no local credential: the tokenless
loopback grace SHALL apply where the listener grants it, and the upgrade SHALL be
refused where it does not. In neither case SHALL a server counter-proof be
emitted.

#### Scenario: Invalid proof on a grace listener
- **WHEN** a loopback bridge presents an invalid proof to a listener that still grants the tokenless grace
- **THEN** the upgrade SHALL be admitted as a deprecated tokenless connection
- **AND** no server counter-proof SHALL be sent

#### Scenario: Invalid proof on a no-grace listener
- **WHEN** a bridge presents an invalid proof to the loopback fallback listener
- **THEN** the upgrade SHALL be refused with the invalid-proof cause

### Requirement: The gateway answers a verified proof with a server counter-proof
When the gateway admits a TCP bridge upgrade on a verified local credential
proof, the upgrade response SHALL carry a server counter-proof in the
`X-Pi-Local-Proof-Server` header: a MAC, keyed from the local token, over the
same binding, the client's nonce and the client's MAC. The gateway SHALL NOT
send a counter-proof on unix-socket upgrades, on upgrades admitted by ticket,
legacy token or grace, or on refused upgrades.

#### Scenario: Verified bridge receives a counter-proof
- **WHEN** a bridge's proof verifies and the upgrade is admitted
- **THEN** the `101` response SHALL include `X-Pi-Local-Proof-Server`
- **AND** the counter-proof SHALL verify against the bridge's own nonce, MAC and binding

#### Scenario: Unix-socket upgrade carries no counter-proof
- **WHEN** a bridge upgrades over the unix socket on a gateway that also serves TCP
- **THEN** the response SHALL NOT include `X-Pi-Local-Proof-Server`

### Requirement: Dashboard-spawned bridges verify the server before registering
A bridge spawned by a proof-capable dashboard to run on the dashboard's own
operating system instance, at a loopback endpoint, SHALL be marked with the
endpoint URL the marker applies to, delivered through every such spawn path
including tmux. A bridge spawned into another kernel or home directory (for
example a WSL pane spawned by a Windows dashboard) SHALL NOT be marked, and an
inherited marker SHALL be removed from every spawned environment before the
marker for this spawn is set.
When such a bridge dials exactly that endpoint over loopback TCP, it SHALL verify
the server counter-proof upon receiving the upgrade response and before the
connection is considered open; it SHALL NOT send any frame, including a buffered
registration, and SHALL NOT act on any received frame unless the counter-proof
verifies. The marker SHALL NOT impose verification on any other endpoint
(`/dashboard-connect` targets, rendezvous- or discovery-sourced endpoints,
remote endpoints, the unix socket). The bridge SHALL compare the marker with
the dialled endpoint as a parsed address and port, and a marker it cannot parse
SHALL require verification on every loopback TCP dial; an empty marker SHALL
mean unmarked. This requirement adds to,
and does not replace, instance-identity verification against a rendezvous
record.

#### Scenario: Squatter without counter-proof is refused
- **WHEN** a marked spawned bridge dials its endpoint and the upgrade response lacks a valid counter-proof
- **THEN** the bridge SHALL abort the connection before it opens
- **AND** it SHALL NOT send `session_register` or any other frame on it

#### Scenario: Genuine dashboard is accepted
- **WHEN** a marked spawned bridge receives a valid counter-proof
- **THEN** the connection SHALL open and registration SHALL proceed

#### Scenario: tmux-spawned session is marked
- **WHEN** the dashboard spawns a session inside tmux
- **THEN** the marker SHALL reach the pane's environment

#### Scenario: WSL-spawned session is not marked
- **WHEN** a Windows dashboard spawns a session through WSL
- **THEN** the spawned environment SHALL NOT carry the marker

#### Scenario: Inherited marker is not propagated
- **WHEN** the dashboard spawns a session from an environment that already carries a marker
- **THEN** the spawned environment SHALL carry only the marker for this spawn, or none

#### Scenario: Near-miss endpoint forms still enforce
- **WHEN** a marked bridge dials its endpoint written with a trailing slash, different letter case, or an explicit path
- **THEN** it SHALL still require the counter-proof

#### Scenario: Unparsable marker fails closed
- **WHEN** the marker value cannot be parsed as an endpoint
- **THEN** the bridge SHALL require a counter-proof on every loopback TCP dial

#### Scenario: Marker does not reach other endpoints
- **WHEN** a marked bridge (or a descendant inheriting its environment) dials an endpoint other than the one the marker names
- **THEN** it SHALL NOT require a counter-proof for that dial

#### Scenario: Unmarked bridge does not require a counter-proof
- **WHEN** a bridge without the marker (manually started pi, rendezvous or legacy endpoint) dials loopback TCP
- **THEN** it SHALL still send a proof rather than the raw token
- **AND** it SHALL NOT require a counter-proof

### Requirement: A server identity-proof failure is non-transient and reported off the suspect channel
A counter-proof failure SHALL NOT be retried on the transient reconnect backoff.
The bridge SHALL retry that endpoint only on a quarantine backoff, SHALL record
the failure where the suspect server cannot observe or suppress it, and SHALL
deliver the record to a dashboard only over a later connection to the same
endpoint whose counter-proof verified — never over a connection to another
endpoint (for example after `/dashboard-connect`).

#### Scenario: Quarantine instead of a reconnect storm
- **WHEN** a counter-proof check fails
- **THEN** the next dial to that endpoint SHALL wait at least the quarantine minimum (5 seconds), growing on repeated failures to a cap of 5 minutes
- **AND** the quarantine SHALL lift after the next verified connection

#### Scenario: Report never travels through the suspect socket
- **WHEN** a counter-proof check fails
- **THEN** the failure SHALL be appended to an owner-only local log
- **AND** the bridge diagnostic SHALL be delivered only once a later connection to the same endpoint verifies its counter-proof

#### Scenario: Report does not follow a move
- **WHEN** a counter-proof failure is pending and the session is moved to another dashboard
- **THEN** the pending report SHALL NOT be sent to that dashboard

#### Scenario: Recovery after the genuine dashboard returns
- **WHEN** the squatter releases the endpoint and the genuine dashboard serves it again
- **THEN** the spawned bridge SHALL reconnect on its next quarantine retry and register normally

### Requirement: Raw local token acceptance is a bounded legacy window
Clients of this version SHALL NOT transmit the raw local token on any dial or
request. The server SHALL continue to accept the raw `X-Pi-Local-Token` header
from older clients until the 1.0.0 horizon shared with the tokenless loopback
grace, behind a single server switch that stays on in this version.

#### Scenario: Old bridge keeps working in the window
- **WHEN** a bridge that predates this change presents the raw local token
- **THEN** the server SHALL admit it as before and log the admission as deprecated
