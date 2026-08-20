# zrok-tunnel Specification Delta

## MODIFIED Requirements

### Requirement: Reserved-name lifecycle
The tunnel module SHALL manage zrok v2 reserved **names** (which replace v1 reserved
tokens). "A persistent tunnel is requested" means `tunnel.zrok.persistent === true`. When a
persistent tunnel is requested and no name is stored, the module SHALL generate a DNS-safe name
(`pi-dash-<random>`), reserve it with `zrok2 create name -n public <name>` (treating an already-exists-for-this-account result as success), and persist it as
`tunnel.zrok.reservedName`. A reserved name SHALL **survive** disconnect and server restart
(that is the purpose of reservation); the module SHALL release the name with
`zrok2 delete name <name>` ONLY on an explicit user "forget reserved URL" action, or when the
user REPLACES the stored name with a different one, never on a normal
`deleteTunnel`/disconnect. The v1 verbs `reserve`/`share reserved`/`release` SHALL NOT
be used.

A user MAY supply the reserved name instead of accepting a generated one. A user-supplied name
SHALL be validated against the DNS-safe allow-list before it reaches zrok argv, and SHALL be
served verbatim when valid. Reservation outcomes SHALL be reported as a typed result
(`ok` / `taken` / `invalid` / `write-failed`) rather than collapsing every failure into a bare
null, so a caller can state WHY a persistent name was not used.

#### Scenario: Reserve a new name
- **WHEN** a persistent tunnel is requested and no `reservedName` is stored
- **THEN** the module SHALL run `zrok2 create name -n public <generated>`, persist the name, and serve it → `https://<generated>.shares.zrok.io`

#### Scenario: Reuse an existing name across restart
- **WHEN** a `reservedName` is already stored (e.g. after a server restart)
- **THEN** the module SHALL skip generation and serve the stored name (stable URL); if `create name` reports it already exists for this account, the module SHALL proceed to serve without error

#### Scenario: Name taken by another account
- **WHEN** `create name` fails because the name is owned by a different account
- **THEN** the module SHALL log a warning and fall back to an ephemeral share (NOT silently rotate a persisted name)

#### Scenario: Disconnect preserves the reserved name
- **WHEN** a reserved tunnel is disconnected via `deleteTunnel`
- **THEN** the module SHALL kill the share process but SHALL NOT delete the name; a later reconnect serves the same URL

#### Scenario: Explicit forget releases the name
- **WHEN** the user explicitly forgets the reserved URL via `POST /api/tunnel-disconnect` with body `{ forget: true }`
- **THEN** the module SHALL run `zrok2 delete name <name>`, clear `tunnel.zrok.reservedName`, and set `tunnel.zrok.persistent` to false

#### Scenario: User supplies a custom name
- **WHEN** the user supplies a DNS-safe name `robson-home-mac` and no name is stored
- **THEN** the module SHALL run `zrok2 create name -n public robson-home-mac`, persist it as `tunnel.zrok.reservedName`, set `tunnel.zrok.persistent` to true, and return an `ok` outcome

#### Scenario: Replacing a stored name releases the old one
- **WHEN** a `reservedName` `old-name` is stored and the user sets a different name `new-name` that reserves successfully
- **THEN** the module SHALL persist `new-name` AND run `zrok2 delete name old-name`, so the account accumulates no orphaned reservation

#### Scenario: Replacement failure leaves the old name intact
- **WHEN** a `reservedName` `old-name` is stored and the user sets `new-name` but its reservation fails
- **THEN** the module SHALL keep `old-name` stored and SHALL NOT release it, so a failed edit cannot destroy a working URL

#### Scenario: User-supplied name is not DNS-safe
- **WHEN** the user supplies a name that fails the DNS-safe allow-list (e.g. a leading hyphen or an underscore)
- **THEN** the module SHALL reject it with an `invalid` outcome, SHALL NOT invoke zrok, and SHALL leave any stored name unchanged

#### Scenario: Reservation succeeds but the config write fails
- **WHEN** `create name` succeeds but persisting `tunnel.zrok.reservedName` fails
- **THEN** the module SHALL return a `write-failed` outcome and SHALL NOT serve the unpersisted name (it would be lost on restart and orphaned remotely)

#### Scenario: stderr classification is pinned
- **WHEN** `create name` fails with stderr that matches neither the already-exists-for-this-account form nor a recognised taken-by-another form
- **THEN** the module SHALL report a generic reservation failure rather than misclassifying it as a reusable existing name

## ADDED Requirements

### Requirement: Reserved-name configuration endpoint
The server SHALL expose an endpoint that sets, replaces or clears the zrok reserved name
independently of connecting a tunnel, so a user learns whether their chosen name is usable at
the moment they choose it rather than after a later connect. Setting a name SHALL also set
`tunnel.zrok.persistent` to true. The endpoint SHALL return the typed reservation outcome so
the client can render the specific reason for a rejection.

The endpoint mutates persisted config **and** creates or destroys a remote resource on the
operator's zrok account. It SHALL therefore sit behind the same network guard and
authentication gate as the other config-mutating routes; it SHALL NOT be reachable
unauthenticated merely because it is read-shaped from the client's perspective.

Setting a name while a tunnel is already live SHALL NOT silently leave the live tunnel
serving a different URL than the one now stored. The endpoint SHALL either apply the name
by reconnecting, or return the reservation outcome together with an explicit indication
that the running tunnel still serves the previous URL until it is reconnected. Storing a
name that the live tunnel does not serve, with no such indication, is the exact silent
divergence this change exists to remove.

#### Scenario: Set a name while the tunnel is disconnected
- **WHEN** the user sets a valid, available name and no tunnel is active
- **THEN** the server SHALL reserve and persist it, set `persistent` to true, and return an `ok` outcome without starting a tunnel

#### Scenario: Set a name that is taken by another account
- **WHEN** the user sets a name owned by a different zrok account
- **THEN** the server SHALL return a `taken` outcome naming the cause, and SHALL leave the stored name and `persistent` flag unchanged

#### Scenario: Clear the configured name
- **WHEN** the user clears the reserved name
- **THEN** the server SHALL release the stored name, clear `tunnel.zrok.reservedName`, and set `tunnel.zrok.persistent` to false

#### Scenario: A release never pulls the reservation out from under a live share
- **GIVEN** a tunnel is actively serving the URL of the name about to be released (on clear, or on the old name during a replace)
- **WHEN** the release is performed
- **THEN** the live share SHALL be torn down **before** `delete name` is issued, matching the existing forget path which calls `deleteTunnel()` first
- **AND** the server SHALL NOT issue `delete name` against a name whose share is still running

#### Scenario: A stored name is used by the next connect
- **WHEN** a name was set via the endpoint and the user subsequently connects
- **THEN** the connect SHALL serve that name without re-prompting or re-validating interactively

#### Scenario: The endpoint is guarded
- **WHEN** a request reaches the reserved-name endpoint without passing the network guard and auth gate applied to config-mutating routes
- **THEN** the server SHALL refuse it
- **AND** SHALL NOT reserve, release, or persist anything

#### Scenario: Setting a name while a tunnel is live is not silently divergent
- **GIVEN** a tunnel is active and serving some URL
- **WHEN** the user sets a different reserved name
- **THEN** the response SHALL either reflect a reconnect onto the new name, or state that the live tunnel still serves the previous URL until reconnected
- **AND** the stored name SHALL NOT be left differing from the served URL with no indication

#### Scenario: A failed reservation while live leaves the tunnel untouched
- **GIVEN** a tunnel is active
- **WHEN** setting a new name returns `taken`, `invalid` or `write-failed`
- **THEN** the running tunnel SHALL be undisturbed and SHALL continue serving its current URL

### Requirement: Degraded persistence reporting
When a `reservedName` is stored and `persistent` is true, but a connect nevertheless serves an
ephemeral share, the tunnel status SHALL carry a signal distinguishing that outcome from a
normal active tunnel. A tunnel that was never configured to be persistent SHALL NOT be reported
as degraded. The signal SHALL be derived from stored-name-versus-effective-name so that a
watchdog recycle does not generate a distinct notification per cycle.

#### Scenario: Connect falls back despite a stored name
- **WHEN** `tunnel.zrok.reservedName` is stored with `persistent: true` but the share is serving an ephemeral URL
- **THEN** the tunnel status SHALL report the tunnel as active AND carry a degraded signal identifying the configured name that was not used

#### Scenario: Ephemeral by configuration is not degraded
- **WHEN** `tunnel.zrok.persistent` is false and an ephemeral share is active
- **THEN** the tunnel status SHALL report a normal active tunnel with no degraded signal

#### Scenario: Degraded signal clears on a successful reserved connect
- **WHEN** a previously degraded tunnel reconnects and successfully serves the stored name
- **THEN** the tunnel status SHALL report a normal active tunnel with no degraded signal

#### Scenario: Watchdog recycle does not re-notify
- **WHEN** the watchdog recycles a degraded tunnel and the same fallback recurs
- **THEN** the status SHALL continue to report the same degraded signal without emitting a new notification per recycle
