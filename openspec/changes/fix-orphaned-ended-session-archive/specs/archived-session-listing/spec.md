## ADDED Requirements

### Requirement: Eviction without an index row keeps the folder count

When the server evicts a session without inserting an archived-index row, the `session_archived { sessionId, cwd, count }` broadcast SHALL carry the folder's current archived count unchanged, and the archive index SHALL NOT change. This covers a manual archive of a fileless ended session and a register that supersedes an ended holder of the same `sessionFile`. This is an explicit exception to the "Count updates on archive" scenario of "Per-folder archived count in the snapshot", which keeps applying to every archive that inserts an index row. `archived_count_updated` SHALL NOT be broadcast for such an eviction.

#### Scenario: Fileless eviction keeps the count
- **WHEN** folder `/a` has 312 archived sessions and a fileless ended session in `/a` is manually archived
- **THEN** the server SHALL broadcast `session_archived { sessionId, cwd: "/a", count: 312 }`
- **AND** `sessions_snapshot.archivedCountByCwd["/a"]` for the next connecting browser SHALL be `312`

#### Scenario: Supersede eviction keeps the count
- **WHEN** folder `/a` has 312 archived sessions and an ended session in `/a` is superseded by a register claiming its `sessionFile`
- **THEN** the server SHALL broadcast `session_archived` for it with `count: 312` and SHALL NOT broadcast `archived_count_updated`
