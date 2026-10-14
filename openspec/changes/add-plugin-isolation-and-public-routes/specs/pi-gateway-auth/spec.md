## MODIFIED Requirements

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

For an isolated plugin spawn (see `plugin-spawn-scope`) the bridge SHALL NOT read the local credential; wherever this requirement accepts a local credential proof (loopback TCP, and the POSIX loopback fallback listener), a proof keyed by that spawn's spawn-scoped bridge credential SHALL also be accepted, for that spawn's bridge registration only (see "Isolated spawns authenticate their bridge with a spawn-scoped credential"). On Windows the owner-only restriction of the local credential is unaffected; the isolated bridge simply never reads it.

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

#### Scenario: Isolated bridge on the fallback listener presents a spawn-scoped proof
- **WHEN** the POSIX loopback fallback listener serves and an isolated session's bridge dials it
- **THEN** a proof keyed by its spawn-scoped credential SHALL be accepted for that spawn's registration
- **AND** the bridge SHALL NOT have read the local credential

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

A proof presented on the bridge gateway upgrade MAY instead be keyed by a key derived, in the same way, from a live spawn-scoped bridge credential; every other rule of this requirement (binding, freshness, listener start, MAC-before-replay, single use) applies unchanged. The spawn-scoped key SHALL be consulted only on the bridge gateway upgrade, never by the request-auth hook, network guard, pairing guards or browser WebSocket upgrade.

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

#### Scenario: Spawn-scoped proof is not consulted off the bridge gateway
- **WHEN** a REST request carries a proof that verifies only under a live spawn-scoped credential
- **THEN** the proof SHALL be treated as absent

### Requirement: The gateway answers a verified proof with a server counter-proof
When the gateway admits a TCP bridge upgrade on a verified local credential
proof, the upgrade response SHALL carry a server counter-proof in the
`X-Pi-Local-Proof-Server` header: a MAC, keyed from the local token, over the
same binding, the client's nonce and the client's MAC. The gateway SHALL NOT
send a counter-proof on unix-socket upgrades, on upgrades admitted by ticket,
legacy token or grace, or on refused upgrades.

The counter-proof SHALL be keyed by the same credential class that verified the bridge's proof: the local token for a local credential proof, the bound spawn-scoped credential for a spawn-scoped proof.

#### Scenario: Verified bridge receives a counter-proof
- **WHEN** a bridge's proof verifies and the upgrade is admitted
- **THEN** the `101` response SHALL include `X-Pi-Local-Proof-Server`
- **AND** the counter-proof SHALL verify against the bridge's own nonce, MAC and binding

#### Scenario: Unix-socket upgrade carries no counter-proof
- **WHEN** a bridge upgrades over the unix socket on a gateway that also serves TCP
- **THEN** the response SHALL NOT include `X-Pi-Local-Proof-Server`

#### Scenario: Counter-proof keyed by the spawn-scoped credential
- **WHEN** the gateway admits an isolated bridge on a spawn-scoped proof
- **THEN** its counter-proof SHALL be keyed by that spawn-scoped credential and SHALL verify under it

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

An isolated bridge SHALL verify the counter-proof with its spawn-scoped bridge credential instead of the local token; the marking, endpoint comparison and no-frame-before-verification rules apply unchanged.

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

#### Scenario: Isolated bridge verifies the server without the local token
- **WHEN** a marked isolated bridge dials its marked endpoint over loopback TCP
- **THEN** it SHALL verify the counter-proof with its spawn-scoped credential before sending any frame

## ADDED Requirements

### Requirement: Isolated spawns authenticate their bridge with a spawn-scoped credential

For every isolated plugin spawn (valid `scope.agentDir`, see `plugin-spawn-scope`) the server SHALL mint a fresh random spawn-scoped bridge credential (at least 256 bits), record it server-side bound to that spawn's `PI_DASHBOARD_SPAWN_TOKEN`, and deliver it to the child only through the environment variable `PI_DASHBOARD_SPAWN_CREDENTIAL`. An isolated bridge SHALL NOT read the operator's local token file. When the bridge dials over loopback TCP it SHALL use the spawn-scoped credential in place of the local token for both its local credential proof and its verification of the server counter-proof, with the same proof grammar, binding, freshness and single-use rules as the local credential proof. Over the owner-only local socket no credential is presented, as for every local bridge.

A connection admitted by a spawn-scoped credential SHALL be accepted only as the bridge of the spawn it is bound to: a registration whose spawn token differs SHALL be refused, and the credential SHALL grant no same-host HTTP exemption, no browser or REST access and no other admission. The server SHALL revoke the credential when the bound session ends, when the spawn fails, or when the spawn is not registered within the existing register-watchdog window; a revoked credential SHALL verify no proof. Credentials SHALL NOT be persisted: after a server restart a live isolated session's bridge can no longer authenticate over loopback TCP, and the plugin is expected to respawn. The bridge SHALL read `PI_DASHBOARD_SPAWN_CREDENTIAL` once at load, keep it in memory for reconnects, and remove it from its process environment so descendants do not inherit it. Because live isolated spawns are capped at 256 (see `plugin-spawn-scope`), verifying a proof against the live spawn-credential set SHALL complete with p95 under 5 ms at 256 live credentials. Non-isolated spawns SHALL NOT receive `PI_DASHBOARD_SPAWN_CREDENTIAL`, and an inherited value SHALL be removed from every spawned environment.

#### Scenario: Isolated bridge registers over loopback TCP without the local token
- **WHEN** an isolated session's bridge dials the dashboard over loopback TCP
- **THEN** it SHALL present a local credential proof keyed by the spawn-scoped credential, verify the server counter-proof with it, and register
- **AND** the operator local token file SHALL NOT be opened by the bridge

#### Scenario: Credential bound to another spawn is refused
- **WHEN** a connection admitted with the spawn-scoped credential of spawn A sends a registration carrying spawn B's token
- **THEN** the registration SHALL be refused

#### Scenario: Spawn-scoped credential grants no HTTP or browser access
- **WHEN** a request to a REST route or the browser WebSocket presents a proof keyed by a spawn-scoped credential
- **THEN** it SHALL receive no credentialed admission

#### Scenario: Credential revoked when the session ends
- **WHEN** the bound isolated session ends and a later dial presents a proof keyed by its credential
- **THEN** the proof SHALL NOT verify

#### Scenario: Bridge scrubs the credential from its environment
- **WHEN** an isolated bridge has loaded
- **THEN** `PI_DASHBOARD_SPAWN_CREDENTIAL` SHALL be absent from its process environment and a reconnect SHALL still authenticate

#### Scenario: Non-isolated spawn never carries a spawn credential
- **WHEN** the server env contains `PI_DASHBOARD_SPAWN_CREDENTIAL` and a session is spawned without `scope.agentDir`
- **THEN** the child env SHALL NOT contain `PI_DASHBOARD_SPAWN_CREDENTIAL`
