## MODIFIED Requirements

### Requirement: On-connect snapshot replaces per-session loop

On every browser WebSocket connect, the browser gateway SHALL emit exactly one `sessions_snapshot` message containing every non-ended session, the `ended` sessions that fall inside the snapshot window (the newest 120 ended sessions overall by end time, plus the first 3 of the ended sequence per session group that has a non-ended session or is pinned), and the per-cwd session orders projected through the same window (an order SHALL NOT reference an id absent from the snapshot's `sessions`). The snapshot SHALL carry `endedTotals`, the count of ended sessions per session group regardless of window, for every group that has at least one ended session. Throughout this requirement "session group" / the `cwd` keys of `orders` and `endedTotals` mean the session group key the sidebar already groups and orders by (pinned directory, else worktree main path, else the session cwd). Snapshot rows SHALL omit `notifyLog` (it is replayed on subscribe). It SHALL NOT emit per-session `session_added` messages or per-cwd `sessions_reordered` messages as part of the on-connect bootstrap.

The snapshot SHALL be the last frame of the connect bootstrap; every other connect-bootstrap frame (`pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, per-cwd `openspec_update`, per-cwd `git_head_update`, `terminal_added`) SHALL be sent before it.

The serialized snapshot SHALL NOT exceed 400 KB for a registry of at most 25 non-ended sessions and 4,000 ended sessions spread across 400 groups with 20 of them pinned, with rows shaped like today's measured sessions.

Live updates after the snapshot SHALL continue to use the existing incremental `session_added`, `session_updated`, `session_removed`, and `sessions_reordered` messages. A live `sessions_reordered` SHALL be projected through the same window as the snapshot.

#### Scenario: Single snapshot per connection
- **WHEN** a new browser WebSocket connection is established
- **THEN** the gateway SHALL send exactly one message of type `sessions_snapshot` to that socket before any other session-registry-related send
- **AND** the gateway SHALL NOT iterate `sessionManager.listAll()` to send per-session `session_added` for that bootstrap
- **AND** the gateway SHALL NOT iterate `sessionOrderManager.getAllOrders()` to send per-cwd `sessions_reordered` for that bootstrap

#### Scenario: Live update after snapshot uses incremental message
- **WHEN** a bridge registers a new session after the snapshot has been sent on that connection
- **THEN** the gateway SHALL emit the incremental `session_added` for that session as before, NOT another snapshot

#### Scenario: Other on-connect sends preserved
- **WHEN** the gateway sends the snapshot on connect
- **THEN** the on-connect sends for `pinned_dirs_updated`, `openspec_update`, `git_head_update`, and `terminal_added` SHALL still be emitted
- **AND** each of them SHALL be sent before `sessions_snapshot` on that socket

#### Scenario: Snapshot is windowed and self-consistent
- **GIVEN** a cwd with 3 non-ended sessions and 500 ended sessions, and a window smaller than 500
- **WHEN** a browser connects
- **THEN** `sessions` SHALL contain all 3 non-ended sessions and only the windowed ended ones
- **AND** every id in `orders[cwd]` SHALL be present in `sessions`
- **AND** `endedTotals[cwd]` SHALL equal 500
- **AND** no row in `sessions` SHALL carry a `notifyLog` field

#### Scenario: Snapshot byte bound
- **GIVEN** a synthetic registry of 25 non-ended and 4,000 ended sessions across 400 groups (20 pinned), each row populated to today's measured field shape
- **WHEN** the snapshot is serialized
- **THEN** its length SHALL be at most 400 KB

#### Scenario: Live reorder is windowed
- **GIVEN** a cwd whose persisted order includes ended ids outside the window
- **WHEN** a `sessions_reordered` is broadcast for that cwd
- **THEN** the broadcast order SHALL contain only ids that a fresh snapshot would contain
