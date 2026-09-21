# network-denial-ring-buffer Specification

## Purpose

Maintain a bounded, anti-poisoning ring buffer of network-guard 403 denials so the UI can offer a "this device was refused — Trust this network?" banner. The buffer records the socket-peer IP of each refused request, coalesces repeats by IP, evicts the oldest distinct IP when full, and exposes a most-recent-first snapshot to an auth-gated read endpoint. Recording is advisory only and never mutates trusted-network policy.

## Requirements

### Requirement: Recording network-guard denials

The system SHALL record a denial whenever the network guard refuses a request with 403 `network_not_allowed`. Each denial entry SHALL capture the socket-peer IP, first-seen time, last-seen time, a running count, and a `trustable` flag. Recording SHALL be best-effort and SHALL NOT block or alter the 403 denial when it fails.

#### Scenario: A refused request is recorded

- **WHEN** the network guard denies a request from a source IP that is not loopback, not in trustedNetworks, and not authenticated
- **THEN** a block event is recorded for that IP with `count` 1
- **AND** `firstSeen` and `lastSeen` are set to the record time
- **AND** the request still receives a 403 response with `error: "network_not_allowed"`

#### Scenario: The recorded IP is the socket peer only

- **WHEN** a denial is recorded for a request
- **THEN** the recorded IP is the socket-peer address (`request.ip`)
- **AND** no value from an `X-Forwarded-For`, `Forwarded`, `X-Real-IP`, or other proxy-forwarding header is used as the recorded IP

#### Scenario: Recording never disrupts the denial

- **WHEN** recording a denial throws an error
- **THEN** the error is swallowed
- **AND** the 403 denial is still sent to the client

### Requirement: Trustability classification

The system SHALL mark an entry `trustable: false` when the peer is a loopback address (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) or the request carried any proxy-forwarding header, so the UI suppresses the one-click "Trust" action for peers where trusting the IP would trust an entire tunnel. A later genuine non-proxied hit MAY upgrade an entry to `trustable: true`; a proxied hit SHALL NOT grant trustability.

#### Scenario: Loopback or proxied peer is non-trustable

- **WHEN** a denial is recorded for a loopback IP, or for a request carrying a proxy-forwarding header
- **THEN** the entry's `trustable` flag is `false`

#### Scenario: Genuine remote peer is trustable

- **WHEN** a denial is recorded for a non-loopback IP on a request with no proxy-forwarding header
- **THEN** the entry's `trustable` flag is `true`

#### Scenario: A genuine hit upgrades a previously non-trustable entry

- **WHEN** an existing entry is `trustable: false` and a later non-proxied, non-loopback denial arrives for the same IP
- **THEN** the entry becomes `trustable: true`
- **AND** a subsequent proxied hit for that IP does not revert it to `false`

### Requirement: Dedup by IP and bounded eviction

The system SHALL coalesce denials by IP: a repeat denial for a known IP bumps its `lastSeen`, increments its `count`, and refreshes its recency rather than creating a new entry. The buffer SHALL be capped at 50 distinct IPs; when a new distinct IP would exceed the cap, the oldest (least recently seen) distinct IP SHALL be evicted, so a flood of spoofed source IPs cannot bury or evict a real denial.

#### Scenario: Repeat denial coalesces into one entry

- **WHEN** a second denial arrives for an IP already in the buffer
- **THEN** no new entry is created
- **AND** that entry's `count` is incremented and `lastSeen` is updated to the new time
- **AND** its `firstSeen` is unchanged

#### Scenario: Oldest distinct IP is evicted at capacity

- **WHEN** a denial for a new distinct IP arrives while the buffer already holds 50 distinct IPs
- **THEN** the least-recently-seen IP is removed
- **AND** the new IP is stored, keeping the buffer at 50 entries

#### Scenario: A repeat hit refreshes recency against eviction

- **WHEN** an IP that was the oldest receives a repeat denial
- **THEN** it is treated as most-recent and is no longer the next eviction candidate

### Requirement: Querying recent denials for the banner

The system SHALL expose the current denials as a most-recent-first snapshot (ordered by `lastSeen` descending) through the auth-gated `GET /api/tunnel/block-events` endpoint that powers the "Trust this network?" banner. The endpoint SHALL return the list without mutating trusted-network policy.

#### Scenario: Snapshot is ordered most-recent-first

- **WHEN** a client reads `GET /api/tunnel/block-events`
- **THEN** the response contains the block events sorted by `lastSeen` descending
- **AND** each event carries `ip`, `firstSeen`, `lastSeen`, `count`, and `trustable`

#### Scenario: Reading denials does not change trust policy

- **WHEN** the block-events snapshot is queried
- **THEN** trustedNetworks configuration is unchanged
- **AND** trusting or removing a network is performed separately through `PUT /api/config`

### Requirement: Denial ledger generalizes beyond the tunnel banner

The denial ledger SHALL record guard denials from every guarded plane, not only tunnel-originated network denials, and SHALL expose them as pending access requests. Generalizing the ledger SHALL preserve all four existing anti-poisoning properties without relaxation: socket-peer IP only, dedupe by IP, bounded capacity with oldest-distinct eviction, and `trustable` classification.

#### Scenario: Denials from any guarded namespace are recorded

- **WHEN** the guard denies a request to any guarded namespace
- **THEN** a ledger entry SHALL be recorded for the socket-peer IP

#### Scenario: Anti-poisoning properties are preserved

- **WHEN** the generalized ledger records a denial
- **THEN** the recorded IP SHALL still be the socket peer only
- **AND** repeats SHALL still coalesce by IP
- **AND** the buffer SHALL still evict the oldest distinct IP at capacity
- **AND** loopback and proxy-terminated peers SHALL still be marked `trustable: false`

#### Scenario: A refused CORS origin is recorded without changing the dedupe key

- **WHEN** a CORS origin refusal is recorded
- **THEN** the refused origin SHALL be captured as an additional field on the entry
- **AND** the entry SHALL still be keyed and deduped by socket-peer IP

### Requirement: Eviction under the queue role degrades to today's behaviour

The ledger changes role from an advisory record into an actionable pending-request queue, so capacity eviction can now drop an entry a user might have accepted. An evicted pending request SHALL degrade to the pre-existing terminal denial, and a subsequent retry by the same peer SHALL re-record it.

#### Scenario: Evicted pending request degrades, not fails

- **GIVEN** a pending access request is evicted when a flood of distinct IPs exceeds capacity
- **WHEN** the evicted peer retries
- **THEN** its denial SHALL be recorded again as a new pending request
- **AND** no access SHALL have been granted as a side effect of eviction

### Requirement: The denial is the access request

A denied client SHALL NOT need to send any additional message to request access. The recorded denial SHALL itself constitute the pending access request, so no unauthenticated inbound write is introduced.

#### Scenario: No inbound request endpoint exists

- **WHEN** a client is denied
- **THEN** access SHALL be requestable without that client posting to any endpoint
- **AND** no unauthenticated endpoint SHALL exist for creating a pending access request

#### Scenario: Denied client retry succeeds after acceptance

- **GIVEN** a denied client's entry has been accepted by a trusted client
- **WHEN** the denied client retries its request
- **THEN** the request SHALL be admitted by the normal pass conditions

### Requirement: Accepting a pending request grants through the existing write path

A trusted client SHALL be able to accept a pending access request. Acceptance SHALL add the peer to trusted networks through the existing configuration write path. The ledger itself SHALL remain advisory and SHALL NOT mutate trust policy.

#### Scenario: Acceptance writes trusted networks

- **WHEN** a trusted client accepts a pending access request
- **THEN** the peer SHALL be added to trusted networks via the existing config write path

#### Scenario: Ledger never mutates policy directly

- **WHEN** denials are recorded or listed
- **THEN** trusted-network configuration SHALL be unchanged

#### Scenario: Non-trustable entries cannot be accepted

- **GIVEN** a ledger entry marked `trustable: false` because the peer is loopback or proxy-terminated
- **WHEN** the pending access requests are presented
- **THEN** the accept action SHALL be suppressed for that entry
