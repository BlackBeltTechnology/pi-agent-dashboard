# agent-teams-ui-live-state Specification

## Purpose
TBD - created by archiving change add-agent-teams-ui. Update Purpose after archive.

## Requirements

### Requirement: Snapshots carry a revision, an epoch and an ETag

Snapshots SHALL include core's per-team `rev` and a random `epoch` minted at server start, and SHALL be served with `ETag: "<epoch>:<rev>"` (`"<epoch>:<rev>:ro"` for a viewer who cannot control the team, because the body carries the per-viewer `viewerCanControl`). A request whose `If-None-Match` equals the current ETag exactly SHALL be answered 304 without a body; any other value (weak, list, `*`, stale, garbage) SHALL be answered 200 with the full snapshot.

#### Scenario: Restart changes epoch
- **WHEN** the server restarts
- **THEN** snapshots carry a new `epoch` and an old ETag no longer matches

#### Scenario: Nothing changed
- **WHEN** a client refetches with the current ETag
- **THEN** the answer is 304 with no snapshot body

### Requirement: Changes are broadcast as coalesced content-free invalidations

On core's store `change` event the server SHALL send at most one `plugin_event` frame per team per 1000 ms, leading and trailing (the first mutation of a quiet team is sent at once, at most one more follows at +1000 ms), session-scoped to the lead session, with `eventType: "agent-teams:changed"` and `data` limited to `{teamId, epoch, rev, closed?}`. A frame SHALL NOT contain names, task text, mail text or any agent-authored string.

#### Scenario: Burst of mutations
- **WHEN** twenty mutations occur within 100 ms
- **THEN** one frame is sent at once and one more within 1000 ms carrying the latest `rev`, and no others

#### Scenario: No content in frames
- **WHEN** a mail is sent
- **THEN** the resulting frame contains only ids and counters

### Requirement: Clients refetch the snapshot, never apply deltas

On a frame whose `epoch` differs or whose `rev` is greater than the cached `rev`, the store SHALL mark the team stale and refetch single-flight with a 500 ms debounce (2 000 ms max-wait, see below). It SHALL also refetch on first use, on socket reconnect, when a hidden tab becomes visible, and every 60 s while visible (conditional). A hidden tab SHALL NOT poll.

#### Scenario: Missed frame
- **WHEN** a frame is dropped and a later frame arrives with a higher `rev`
- **THEN** one refetch yields the full current state

#### Scenario: Last frame shed
- **WHEN** the final frame of a burst never reaches a visible tab
- **THEN** the view converges to the current state within 60 s

#### Scenario: Reconnect
- **WHEN** the socket reconnects while a Team view is open
- **THEN** exactly one refetch is made

### Requirement: Refetch timing cannot be starved

The first use of a team SHALL fetch immediately. The 500 ms debounce SHALL have a 2 000 ms max-wait, so that continuous frames cannot postpone a refetch beyond it.

#### Scenario: First use
- **WHEN** the Team view opens for a team that is not cached
- **THEN** the snapshot is requested at once, without waiting for the debounce

#### Scenario: Continuous frames
- **WHEN** frames keep arriving every 400 ms for a minute
- **THEN** a snapshot request is made within 2 000 ms of the first unfetched frame and at least every 2 000 ms after it

### Requirement: Refetch load is bounded

One open Team view SHALL cause at most one full snapshot request per second in steady state. The snapshot's mail tail SHALL be limited by core's recent-mail bound, and the 304 path SHALL be used whenever nothing visible changed.

#### Scenario: Busy team
- **WHEN** a team mutates continuously for a minute
- **THEN** one open view issues at most 60 snapshot requests

### Requirement: Frame feed tolerates session event resets

The store SHALL be fed by a small component mounted with the Team view that reads the lead session's plugin events and the shell connection status. A reset of the session events array SHALL be treated as "no information", never as a state change, and the cached snapshot SHALL be kept.

#### Scenario: Session state reset
- **WHEN** the session events array is cleared while the view is open
- **THEN** the cached snapshot stays on screen and the next refetch trigger refreshes it

### Requirement: Failed refresh keeps the last snapshot

When a refetch fails the store SHALL keep the cached snapshot, mark it stale, retry with delays 1 s, 2 s, 4 s then every 30 s, and honour `Retry-After` on HTTP 429. At most one request per team SHALL be in flight.

#### Scenario: Rate limited
- **WHEN** the snapshot route answers 429 with `Retry-After`
- **THEN** the store waits that long and shows the stale snapshot meanwhile

### Requirement: Retry-After is honoured within bounds

The store SHALL accept `Retry-After` as delta-seconds or an HTTP-date and clamp the wait to [1 s, 120 s]; an invalid or absent value SHALL use the normal backoff. A frame arriving during the wait SHALL NOT bypass it.

#### Scenario: Large Retry-After
- **WHEN** the snapshot route answers 429 with `Retry-After: 86400`
- **THEN** the store waits 120 s and keeps showing the stale snapshot

#### Scenario: Frame during backoff
- **WHEN** a frame arrives while the store waits out a backoff
- **THEN** the wait is not shortened

### Requirement: Status changes are announced politely and sparsely

The Team view SHALL derive announcements from the difference between consecutive snapshots (member status, task completed, team closed) and SHALL emit them through one polite live region at most once per 4 seconds, summarising multiple changes and excluding message text.

#### Scenario: Task completes
- **WHEN** a snapshot shows task 3 newly completed
- **THEN** the live region announces "task 3 completed"
