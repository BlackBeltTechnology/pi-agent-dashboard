## ADDED Requirements

### Requirement: Sidecar SHALL persist optional liveness and close-reason fields

The `.meta.json` sidecar SHALL support three additional optional fields: `live` (boolean), `liveEpoch` (number — the server boot id under which the session was last seen running), and `closedReason` (string, e.g. `"manual"`). As with all sidecar fields, these SHALL be optional and backward-compatible; a sidecar lacking them SHALL read without error.

#### Scenario: New fields persisted when set

- **WHEN** the server sets liveness state on a session (`live`, `liveEpoch`, or `closedReason`)
- **THEN** those fields SHALL be written to the session's `.meta.json`

#### Scenario: Absent fields are backward-compatible

- **GIVEN** a `.meta.json` written before this change with no `live` / `liveEpoch` / `closedReason`
- **WHEN** the server reads it
- **THEN** it SHALL read without error and treat the liveness fields as absent

### Requirement: Liveness marker SHALL use an eager write path bypassing the debounce

The liveness marker (`live` / `liveEpoch`) SHALL be persisted via an immediate atomic write (tmp + rename) rather than the existing per-session debounced write queue, so the marker is durable on disk before an unclean shutdown. The debounced path SHALL remain in use for all other dashboard-owned fields.

#### Scenario: Liveness write is immediate

- **WHEN** the server stamps `live: true` on session activation
- **THEN** the write SHALL be flushed to `.meta.json` immediately, not deferred to the debounce window

#### Scenario: Non-liveness fields still debounced

- **WHEN** a session receives a token/stats update (a non-liveness field)
- **THEN** that field SHALL still be written via the existing debounced path

#### Scenario: Eager write remains atomic

- **GIVEN** the server crashes mid-write of the liveness marker
- **WHEN** the sidecar is next read
- **THEN** the previous valid `.meta.json` SHALL remain intact (write-to-temp + rename)
