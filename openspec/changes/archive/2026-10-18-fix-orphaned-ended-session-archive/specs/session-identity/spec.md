## ADDED Requirements

### Requirement: A register supersedes an ended holder of the same session file

When a `session_register` carries `sessionFile = F` for session id `S2`, and a *different* resident session `S1` with `status = "ended"` holds `sessionFile = F`, the server SHALL make `S2` the sole owner of `F` and SHALL evict `S1` from the live set: broadcast `session_archived` for `S1`, write nothing to `F`'s sidecar (which now belongs to `S2`), and insert no archived-index row. The eviction SHALL apply even when `S1` carries `live: true`, because that marker describes `F`, which `S2` now owns. This eviction is not an archive: it sets no `archived` flag, creates no archived-index row, and offers no restore. The `session-archive` interrupted-session rule therefore does not apply to it. The server SHALL evict without first broadcasting a `sessionFile: null` update for `S1`. A resident holder of `F` whose status is *not* `ended` SHALL keep the existing behaviour: its `sessionFile` is cleared and it stays resident. A register that reuses the *same* id (`S1 === S2`, continue / reconnect) SHALL NOT evict anything.

#### Scenario: Ended predecessor is superseded
- **WHEN** session `S1` is resident with `status = "ended"` and `sessionFile = F`
- **AND** session `S2` (≠ `S1`) registers with `sessionFile = F`
- **THEN** `S1` SHALL be removed from the live set and `session_archived` SHALL be broadcast for `S1`
- **AND** `S2` SHALL be resident with `sessionFile = F`
- **AND** `F`'s `.meta.json` SHALL NOT receive `archived: true`

#### Scenario: Ended holder marked live is still superseded
- **WHEN** session `S1` is resident with `status = "ended"`, `live = true`, and `sessionFile = F`
- **AND** a different session `S2` registers with `sessionFile = F`
- **THEN** `S1` SHALL be evicted from the live set

#### Scenario: No orphan remains after supersede
- **WHEN** the supersede above has happened
- **THEN** no resident session SHALL exist with `status = "ended"` whose `sessionFile` was cleared by that register

#### Scenario: Non-ended holder keeps today's behaviour
- **WHEN** a resident session `S1` with `status` other than `ended` holds `sessionFile = F`
- **AND** a different session `S2` registers with `sessionFile = F`
- **THEN** `S1`'s `sessionFile` SHALL be cleared and `S1` SHALL remain resident

#### Scenario: Same-id reconnect does not evict
- **WHEN** session `S1` (ended, `sessionFile = F`) re-registers as `S1` with `sessionFile = F`
- **THEN** no session SHALL be evicted and `S1` SHALL become active as before
