## MODIFIED Requirements

### Requirement: Sidecar SHALL persist optional liveness and close-reason fields

The `.meta.json` sidecar SHALL support three additional optional fields: `live` (boolean), `liveEpoch` (number), and `closedReason` (string, e.g. `"manual"`). While `live` is `true`, `liveEpoch` SHALL be the server boot id under which the session was last seen running. While `live` is not `true`, a present `liveEpoch` SHALL be the server boot id in which the session ended through its bridge's explicit unregister (shutdown-window evidence); it SHALL be absent otherwise. As with all sidecar fields, these SHALL be optional and backward-compatible; a sidecar lacking them SHALL read without error.

#### Scenario: New fields persisted when set

- **WHEN** the server sets liveness state on a session (`live`, `liveEpoch`, or `closedReason`)
- **THEN** those fields SHALL be written to the session's `.meta.json`

#### Scenario: Ended sidecar carries the ending boot

- **GIVEN** a session whose bridge sent `session_unregister` during boot `B`
- **WHEN** its `.meta.json` is read afterwards
- **THEN** it SHALL carry `live: false` and `liveEpoch = B`

#### Scenario: Absent fields are backward-compatible

- **GIVEN** a `.meta.json` written before this change with no `live` / `liveEpoch` / `closedReason`
- **WHEN** the server reads it
- **THEN** it SHALL read without error and treat the liveness fields as absent

### Requirement: Liveness marker SHALL use an eager write path bypassing the debounce

The liveness marker (`live` / `liveEpoch`) and any concurrent `closedReason` update SHALL be persisted via an immediate atomic write (tmp + rename) rather than the existing per-session debounced write queue, so the marker is durable on disk before an unclean shutdown. The eager write SHALL first merge any pending debounced snapshot for that session so a queued stats update is not clobbered, and SHALL clear liveness fields absent from the current payload rather than carry stale values forward. The debounced path SHALL remain in use for all other dashboard-owned fields.

The eager write SHALL additionally accept an optional `endedAt`. When present it SHALL be persisted in the same atomic write. `endedAt` is NOT a liveness field: when absent from the payload, the `endedAt` of the write's base (the pending debounced snapshot when one exists, otherwise the on-disk sidecar) SHALL be retained, not cleared. A later debounced full-sidecar write SHALL NOT drop a persisted `liveEpoch`.

#### Scenario: Liveness write is immediate

- **WHEN** the server stamps `live: true` on session activation
- **THEN** the write SHALL be flushed to `.meta.json` immediately, not deferred to the debounce window

#### Scenario: Eager write merges pending debounced fields

- **GIVEN** a queued (not-yet-flushed) debounced stats update for a session
- **WHEN** an eager liveness write occurs for that session
- **THEN** the queued fields SHALL be merged into the atomic write and not lost

#### Scenario: Omitted liveness fields are cleared, not carried forward

- **GIVEN** a sidecar carrying `closedReason: "manual"` from a prior close
- **WHEN** an eager write stamps `{ live: true, liveEpoch }` without a `closedReason`
- **THEN** the persisted `closedReason` SHALL be removed, not retained

#### Scenario: Eager end write persists endedAt

- **WHEN** an eager write stamps `{ live: false, liveEpoch, endedAt }`
- **THEN** `.meta.json` SHALL contain that `endedAt` immediately, without waiting for the debounce window

#### Scenario: Omitted endedAt is retained

- **GIVEN** a sidecar carrying `endedAt`
- **WHEN** an eager write stamps `{ live: false }` without `endedAt`
- **THEN** the persisted `endedAt` SHALL be unchanged

#### Scenario: Debounced overwrite keeps liveEpoch

- **GIVEN** a sidecar carrying `live: false` and `liveEpoch`
- **WHEN** a debounced stats write for that session is flushed
- **THEN** the persisted `liveEpoch` SHALL be unchanged

#### Scenario: Non-liveness fields still debounced

- **WHEN** a session receives a token/stats update (a non-liveness field)
- **THEN** that field SHALL still be written via the existing debounced path

#### Scenario: Eager write remains atomic

- **GIVEN** the server crashes mid-write of the liveness marker
- **WHEN** the sidecar is next read
- **THEN** the previous valid `.meta.json` SHALL remain intact (write-to-temp + rename)
