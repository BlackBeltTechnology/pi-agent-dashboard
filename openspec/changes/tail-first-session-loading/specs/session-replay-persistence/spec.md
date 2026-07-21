# session-replay-persistence Delta Specification

## MODIFIED Requirements

### Requirement: Durable replay cursor survives page reload

The client SHALL persist a per-session replay cursor (`maxSeq`) and the RAW event
tail (`{ seq, event }[]`, NOT a reduced chat-message snapshot) to IndexedDB, and
SHALL rehydrate on page load by re-reducing those raw events so an already-seen
session resubscribes with a non-zero `lastSeq`, triggering a delta replay rather
than a full replay.

The persisted payload SHALL be the tail segment only: events seeded by a
`kind: "tail"` window plus events appended by `kind: "delta"` batches and live
`event` messages. Older paginated windows (`kind: "older"`) SHALL NOT be
persisted, so the cache stays bounded regardless of how far the user paginates.

#### Scenario: Reload of a seen session delta-replays

- **WHEN** a session was previously subscribed (cache holds `maxSeq = N`) and the
  page is reloaded
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: N }`
- **AND** the server SHALL replay only events with `seq > N` (`kind: "delta"`)
- **AND** the client SHALL NOT request a full replay (`lastSeq: 0`) for that
  session

#### Scenario: Reload of a never-seen session tail-replays

- **WHEN** the page is reloaded and no cache entry exists for a session
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: 0 }`
- **AND** the server SHALL send the tail window (`kind: "tail"`, see
  `chat-history-pagination`)

#### Scenario: Rehydrated state renders before the delta arrives

- **WHEN** a cache entry exists on load
- **THEN** the client SHALL render the rehydrated chat as provisional state
  before the `event_replay` delta arrives
- **AND** SHALL reconcile it against the arriving batches via the `kind`
  metadata (a `kind: "tail"` response replaces the provisional state; a
  `kind: "delta"` response extends it)

#### Scenario: Older pages are not persisted

- **WHEN** the user paginates several `load_older` windows and then reloads the
  page
- **THEN** the rehydrated buffer SHALL contain only the persisted tail segment
- **AND** the older history SHALL be reachable again via scroll-up pagination
