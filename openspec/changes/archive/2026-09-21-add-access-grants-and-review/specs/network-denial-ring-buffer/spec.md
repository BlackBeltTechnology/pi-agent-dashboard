## ADDED Requirements

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
