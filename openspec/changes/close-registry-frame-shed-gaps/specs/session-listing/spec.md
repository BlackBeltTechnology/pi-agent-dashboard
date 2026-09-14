## MODIFIED Requirements

### Requirement: Browser pages older ended sessions on demand

In this requirement `cwd` on `sessions_page` / `sessions_page_result` and the keys of `endedTotals` denote the session group key the sidebar already groups by (pinned directory, else worktree main path, else session cwd), so a worktree session pages within its parent group. The client SHALL render a folder group for every group key that has a non-zero `endedTotals` entry even when it holds no session for that cwd (a stub group whose only content is the ended expander). When a folder group's ended list is expanded and `endedTotals[cwd]` exceeds the number of ended sessions the client holds for that cwd, the client SHALL request `sessions_page { cwd, offset }` where `offset` is the number of non-window (paged) ended sessions it already holds for that cwd, and SHALL issue at most one page request per cwd at a time (released on ANY `sessions_page_result` for that cwd — including an empty one — on a 15-second timeout, or when the socket opens). A reply with `hasMore: false` SHALL mark the cwd exhausted: the "more" affordance SHALL be hidden and no further `sessions_page` SHALL be sent for that cwd until `endedTotals[cwd]` changes. The server SHALL reply to that browser only with `sessions_page_result { cwd, sessions, order, hasMore }` containing the next batch, taken at `offset` from the cwd's ended sequence (persisted order restricted to ended ids, then ended ids without a persisted position by `startedAt` descending) with the snapshot-window ids excluded, and `hasMore` true when further entries remain. The client SHALL ignore order ids it does not hold when applying any order, and SHALL keep held ids absent from an incoming `sessions_reordered` at the tail rather than evicting them.

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

#### Scenario: Empty reply releases the in-flight mark
- **GIVEN** a page request for `/repoA` is in flight
- **WHEN** `sessions_page_result { cwd: "/repoA", sessions: [], order: [], hasMore: false }` arrives
- **THEN** the in-flight mark for `/repoA` SHALL be released immediately, not after the 15-second timeout

#### Scenario: Exhausted cwd hides the affordance
- **GIVEN** `endedTotals["/repoA"]` exceeds the ended sessions held and the last reply for `/repoA` carried `hasMore: false`
- **WHEN** the sidebar renders
- **THEN** the "more" affordance for `/repoA` SHALL NOT be shown
- **AND** no `sessions_page` SHALL be sent for `/repoA`

#### Scenario: A changed ended total re-arms paging
- **GIVEN** `/repoA` is marked exhausted
- **WHEN** a snapshot or `session_updated` changes `endedTotals["/repoA"]`
- **THEN** the exhausted mark SHALL clear and the affordance SHALL follow the ordinary rule again
