## MODIFIED Requirements

### Requirement: Sessions snapshot replaces client state atomically

The browser message handler (`useMessageHandler`) SHALL handle `sessions_snapshot` by REPLACING the `sessions` Map, the `sessionOrderMap` Map and the `archivedCountByCwd` map with the payload contents. It SHALL NOT merge with existing state. `payload.sessions` SHALL never contain archived sessions.

After replacement, ids that were present in the previous `sessions` Map but are absent from `payload.sessions` SHALL no longer be in `sessions`. Cwds that were present in the previous `sessionOrderMap` but are absent from `payload.orders` SHALL no longer be in `sessionOrderMap`.

#### Scenario: Stale session is dropped on snapshot
- **GIVEN** the client has `sessions` containing id "stale-x" with status "active" from a previous server lifetime
- **WHEN** a `sessions_snapshot` arrives whose `sessions` array does NOT include id "stale-x"
- **THEN** after the message is processed, `sessions.has("stale-x")` SHALL be `false`

#### Scenario: Snapshot replaces sessionOrderMap completely
- **GIVEN** the client has `sessionOrderMap` with entry `{ "/repoA": ["a","b"] }` from a previous server lifetime
- **WHEN** a `sessions_snapshot` arrives with `orders: { "/repoB": ["c"] }`
- **THEN** after the message is processed, `sessionOrderMap.get("/repoA")` SHALL be `undefined`
- **AND** `sessionOrderMap.get("/repoB")` SHALL equal `["c"]`

#### Scenario: Snapshot does not silently merge over fresh ids
- **GIVEN** the snapshot payload contains an updated `DashboardSession` for id "live-y" with status "ended"
- **WHEN** the client previously had id "live-y" with status "active"
- **THEN** after processing, `sessions.get("live-y").status` SHALL equal `"ended"`

#### Scenario: session_archived deletes the id
- **GIVEN** the client has `sessions` containing id "old-z"
- **WHEN** `session_archived { sessionId: "old-z", cwd: "/repoA", count: 6 }` arrives
- **THEN** `sessions.has("old-z")` SHALL be `false` and `archivedCountByCwd["/repoA"]` SHALL be `6`

#### Scenario: Snapshot replaces archived counts
- **GIVEN** the client has `archivedCountByCwd = { "/repoA": 5 }`
- **WHEN** a `sessions_snapshot` arrives with `archivedCountByCwd: { "/repoB": 312 }`
- **THEN** after processing, `/repoA` SHALL have no archived count and `/repoB` SHALL have `312`
