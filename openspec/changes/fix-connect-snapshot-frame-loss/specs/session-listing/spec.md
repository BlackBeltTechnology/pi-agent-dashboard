## MODIFIED Requirements

### Requirement: Sessions snapshot replaces client state atomically

The browser message handler (`useMessageHandler`) SHALL handle `sessions_snapshot` by REPLACING both the `sessions` Map and the `sessionOrderMap` Map with the payload contents. It SHALL NOT merge with existing state. A `sessions_page_result` SHALL be MERGED: its sessions are added to (or overwrite entries in) the `sessions` Map, and its `order` is appended after the cwd's current order with ids already present skipped.

After replacement, ids that were present in the previous `sessions` Map but are absent from `payload.sessions` SHALL no longer be in `sessions` — including ids that were previously merged from a page. Cwds that were present in the previous `sessionOrderMap` but are absent from `payload.orders` SHALL no longer be in `sessionOrderMap`.

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

#### Scenario: Page merges and appends order
- **GIVEN** the client holds `sessionOrderMap.get("/repoA")` equal to `["a","b"]` and sessions `a`, `b`
- **WHEN** a `sessions_page_result { cwd: "/repoA", sessions: [c, d, b], order: ["c","d","b"], hasMore: false }` arrives
- **THEN** `sessions` SHALL contain `a`, `b`, `c`, `d`
- **AND** `sessionOrderMap.get("/repoA")` SHALL equal `["a","b","c","d"]`

#### Scenario: Paged sessions are discarded by the next snapshot
- **GIVEN** the client merged paged session `old-z` for `/repoA`
- **WHEN** a `sessions_snapshot` arrives that does not include `old-z`
- **THEN** `sessions.has("old-z")` SHALL be `false`

## ADDED Requirements

### Requirement: Browser pages older ended sessions on demand

In this requirement `cwd` on `sessions_page` / `sessions_page_result` and the keys of `endedTotals` denote the session group key the sidebar already groups by (pinned directory, else worktree main path, else session cwd), so a worktree session pages within its parent group. The client SHALL render a folder group for every group key that has a non-zero `endedTotals` entry even when it holds no session for that cwd (a stub group whose only content is the ended expander). When a folder group's ended list is expanded and `endedTotals[cwd]` exceeds the number of ended sessions the client holds for that cwd, the client SHALL request `sessions_page { cwd, offset }` where `offset` is the number of non-window (paged) ended sessions it already holds for that cwd, and SHALL issue at most one page request per cwd at a time (released on reply, on a 15-second timeout, or when the socket opens). The server SHALL reply to that browser only with `sessions_page_result { cwd, sessions, order, hasMore }` containing the next batch, taken at `offset` from the cwd's ended sequence (persisted order restricted to ended ids, then ended ids without a persisted position by `startedAt` descending) with the snapshot-window ids excluded, and `hasMore` true when further entries remain. The client SHALL ignore order ids it does not hold when applying any order, and SHALL keep held ids absent from an incoming `sessions_reordered` at the tail rather than evicting them.

#### Scenario: Expanding the ended list pages in the next batch
- **GIVEN** a cwd group with `endedTotal` of 500 and 20 ended sessions held by the client
- **WHEN** the user expands the ended list
- **THEN** the client SHALL send one `sessions_page` for that cwd
- **AND** on `sessions_page_result` the ended list SHALL grow by the page's sessions in order
- **AND** a "more" affordance SHALL be shown while `endedTotals[cwd]` exceeds the ended sessions held for that cwd

#### Scenario: Stub group for a cwd outside the window
- **GIVEN** a snapshot with `endedTotals["/old/wt"]` of 3 and no session for `/old/wt`
- **WHEN** the sidebar renders
- **THEN** a folder group for `/old/wt` SHALL be shown with an ended expander labelled from `endedTotals`
- **AND** expanding it SHALL send `sessions_page { cwd: "/old/wt", offset: 0 }

#### Scenario: Sequential paging per cwd
- **WHEN** a page request for a cwd is in flight
- **THEN** a further expand on the same cwd SHALL NOT send a second `sessions_page` until the first reply arrives

#### Scenario: No paging when everything is held
- **GIVEN** a cwd group whose `endedTotal` equals the ended sessions the client holds
- **WHEN** the user expands the ended list
- **THEN** no `sessions_page` SHALL be sent

#### Scenario: Unknown ids in an order are ignored
- **WHEN** a `sessions_reordered` or `sessions_page_result` order contains an id the client does not hold
- **THEN** the client SHALL apply the order without that id and without error

#### Scenario: Live reorder keeps paged ids
- **GIVEN** the client holds paged ended ids `p1`, `p2` for `/repoA` after `a`, `b`
- **WHEN** a `sessions_reordered { cwd: "/repoA", order: ["b","a"] }` arrives
- **THEN** `sessionOrderMap.get("/repoA")` SHALL equal `["b","a","p1","p2"]`

#### Scenario: Ended-count stays live between snapshots
- **GIVEN** `endedTotals["/repoA"]` of 2
- **WHEN** a `session_updated` transitions a held `/repoA` session to `ended`
- **THEN** the expander label for `/repoA` SHALL reflect 3

### Requirement: Client reconciles missing OpenSpec entries for rendered cwds

The client SHALL compute the set of cwds for which it renders a non-ended session card, a pinned folder card, or the selected-session pane (any status), and for each such cwd that has no settled entry in its OpenSpec map (no entry, or only a `pending: true` placeholder) and no in-flight request, it SHALL send `openspec_get` with a fresh `requestId`. The reconciliation SHALL run when the socket opens (every reconnect), when a `sessions_snapshot` is applied, and whenever the rendered cwd set or the OpenSpec map changes. At most one request per cwd SHALL be in flight; the in-flight mark SHALL be released on a reply with `final: true`, on a 15-second timeout, or when the socket opens. An `openspec_get_result` SHALL be applied to the OpenSpec map exactly as an `openspec_update` for its cwd.

#### Scenario: Card renders for a cwd whose openspec frame never arrived
- **GIVEN** a non-ended session card is rendered for `/repo/w` and the OpenSpec map has no entry for `/repo/w`
- **WHEN** the reconciliation runs
- **THEN** the client SHALL send exactly one `openspec_get` for `/repo/w`
- **AND** on the `final: true` reply the card's OpenSpec section SHALL render according to the returned readiness

#### Scenario: Ended cards and stub groups do not pull
- **GIVEN** only ended session cards or a stub group are rendered for `/old/wt` and the OpenSpec map has no entry for it
- **WHEN** the reconciliation runs
- **THEN** no `openspec_get` SHALL be sent for `/old/wt`

#### Scenario: One in-flight request per cwd across many cards
- **GIVEN** 5 non-ended session cards rendered for the same cwd with no OpenSpec entry
- **WHEN** the reconciliation runs
- **THEN** exactly one `openspec_get` SHALL be sent for that cwd

#### Scenario: Reconnect re-runs the reconciliation
- **GIVEN** an `openspec_get` was in flight when the socket dropped
- **WHEN** the socket reopens and the snapshot is applied
- **THEN** the in-flight mark SHALL be cleared
- **AND** if the cwd still has no entry the client SHALL send a new `openspec_get` for it

#### Scenario: Timeout releases the in-flight mark
- **GIVEN** an `openspec_get` for `/repo/w` received no `final: true` reply
- **WHEN** 15 seconds elapse
- **THEN** a subsequent reconciliation SHALL be allowed to send a new `openspec_get` for `/repo/w`

#### Scenario: Result is applied like an update
- **WHEN** `openspec_get_result { cwd: "/repo/w", data }` arrives
- **THEN** the OpenSpec map entry for `/repo/w` SHALL equal `data`, exactly as if `openspec_update { cwd: "/repo/w", data }` had arrived
