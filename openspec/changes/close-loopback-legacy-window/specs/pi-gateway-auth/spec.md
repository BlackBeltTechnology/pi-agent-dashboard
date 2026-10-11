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
SHALL NOT transmit the credential itself. Every loopback TCP bridge listener —
the POSIX fallback listener served when the local socket bind was refused, and
the Windows loopback listener alike — SHALL require a valid local credential
proof or a valid bridge ticket; no tokenless bridge and no bridge presenting
only the raw local token SHALL be accepted there.

#### Scenario: Socket is owner-only on POSIX
- **WHEN** the dashboard binds the local bridge socket
- **THEN** the socket SHALL have mode `0600`
- **AND** its containing directory SHALL have mode `0700`

#### Scenario: Another user cannot connect on POSIX
- **WHEN** a process running as a different user attempts to connect to the socket
- **THEN** the connection SHALL be refused by the operating system

#### Scenario: POSIX fallback listener requires the local token
- **WHEN** a dashboard on POSIX serves bridges on its loopback fallback listener
- **AND** a process connects to it with no valid local credential proof and no valid bridge ticket
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
- **WHEN** a process connects to a loopback bridge listener
- **AND** it presents neither a valid local credential proof nor a valid bridge ticket
- **THEN** the connection SHALL be refused
- **AND** it SHALL NOT be able to register any session id

#### Scenario: Tokenless loopback bridge is refused
- **WHEN** a bridge dials any loopback TCP bridge listener with no local credential proof and no bridge ticket
- **THEN** the upgrade SHALL be refused with the local-token-missing cause
- **AND** it SHALL NOT be admitted under any deprecation grace

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

### Requirement: Authentication outcomes are observable
Refusing a bridge connection SHALL be recorded with the reason and the transport
involved, distinguishing an unauthenticated attempt, an invalid or reused
ticket, a revoked device, an identity mismatch, an invalid local credential
proof (with its sub-cause), and a missing or invalid server counter-proof.
A request or upgrade that carries the retired raw `X-Pi-Local-Token` header
SHALL be recorded as coming from an outdated client, so an operator can tell a
pre-1.0.0 client from an unauthenticated one.

#### Scenario: Refusal reason is distinguishable
- **WHEN** a bridge connection is refused
- **THEN** the log record SHALL identify which of the refusal causes applied
- **AND** it SHALL NOT report a generic connection error

#### Scenario: Invalid proof sub-cause is recorded
- **WHEN** the server rejects a local credential proof
- **THEN** the server log SHALL name the sub-cause: malformed, stale, before-start, binding-mismatch, bad-mac, replayed, or replay-cache-full
- **AND** the response to the client SHALL NOT reveal the sub-cause

#### Scenario: Legacy token acceptance is recorded
- **WHEN** a request or bridge upgrade carries the raw `X-Pi-Local-Token` header and no `X-Pi-Local-Proof` header
- **THEN** the server SHALL log that an outdated client presented the retired header, naming the caller kind and telling the operator to update or reload it
- **AND** it SHALL emit at most one such line per caller kind per 60 seconds, the next emitted line carrying the number of occurrences suppressed since the previous line
- **AND** the log line SHALL NOT include the header value, nor state whether that value matches the current token

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
to another endpoint SHALL NOT earn any admission on the strength of that proof.

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
be treated exactly as an upgrade carrying no local credential: on a loopback TCP
listener it SHALL be refused unless it carries a valid bridge ticket. No server
counter-proof SHALL be emitted for it.

#### Scenario: Invalid proof on a grace listener
- **WHEN** a bridge presents an invalid proof and no valid bridge ticket to a loopback TCP bridge listener that granted the tokenless grace before 1.0.0
- **THEN** the upgrade SHALL be refused with the invalid-proof cause
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
or on refused upgrades.

#### Scenario: Verified bridge receives a counter-proof
- **WHEN** a bridge's proof verifies and the upgrade is admitted
- **THEN** the `101` response SHALL include `X-Pi-Local-Proof-Server`
- **AND** the counter-proof SHALL verify against the bridge's own nonce, MAC and binding

#### Scenario: Unix-socket upgrade carries no counter-proof
- **WHEN** a bridge upgrades over the unix socket on a gateway that also serves TCP
- **THEN** the response SHALL NOT include `X-Pi-Local-Proof-Server`

## REMOVED Requirements

### Requirement: Raw local token acceptance is a bounded legacy window
**Reason**: The 1.0.0 horizon has arrived. Accepting the raw header kept older
clients leaking the token to a port squatter, and kept a harvested token usable.
**Migration**: Update the CLI and Electron app, and reload pi sessions
(`npm run reload`) so bridges send `X-Pi-Local-Proof`. See "Raw local token is
retired" for the replacement behaviour.

## ADDED Requirements

### Requirement: Raw local token is retired
The server SHALL NOT admit any request or bridge upgrade on the raw
`X-Pi-Local-Token` header. A request carrying only that header SHALL be judged
exactly as a request carrying no local credential: same admission outcome, same
refusal cause, same response body. The server SHALL NOT compare the presented
value against the token, so a refusal reveals nothing about the value. Retiring
the raw header SHALL be accompanied by a one-time rotation of the local token
(see `local-ipc-allowlist-token`), so a token harvested from an older client
stops being a valid proof key.

#### Scenario: Old bridge is refused
- **WHEN** a bridge that predates `loopback-credential-proof` presents only the raw local token on a loopback TCP bridge listener
- **THEN** the upgrade SHALL be refused with the local-token-missing cause
- **AND** the server SHALL log it as an outdated client

#### Scenario: Old CLI is refused on a local-credential route
- **WHEN** an HTTP request to a route that requires a local credential carries only a valid raw `X-Pi-Local-Token`
- **THEN** the response SHALL be identical to the response for the same request with no local credential

#### Scenario: Header alongside a valid proof
- **WHEN** a request carries both a valid `X-Pi-Local-Proof` and an `X-Pi-Local-Token` header
- **THEN** the request SHALL be judged on the proof alone and admitted

#### Scenario: Harvested pre-rotation token cannot mint proofs
- **WHEN** a proof is minted with the token value that was current before the rotation and presented to the server after the rotation
- **THEN** the server SHALL reject it as bad-mac
