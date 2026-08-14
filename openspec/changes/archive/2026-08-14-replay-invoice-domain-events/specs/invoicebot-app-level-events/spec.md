## MODIFIED Requirements

### Requirement: App-level channel is reconnect-safe and delta-only

The app-level channel SHALL stream live deltas. In addition, the server SHALL
retain the **latest** `ib_domain_event` frame per entity key (the invoice, or the
event's own entity when it carries no invoice) and SHALL replay those retained
frames to a browser **on connect**, so a surface that mounts, re-fetches, or
reconnects after an event was emitted converges on current truth instead of
waiting for the next accidental delta.

The retained set SHALL be the latest event per key only — the server SHALL NOT
replay a full historical **log** of domain events, and SHALL NOT be responsible
for out-of-band baseline snapshots. A replayed frame SHALL be distinguishable from
a live frame by an additive `replay: true` field (absent/false on live frames), so
a consumer applies it as an idempotent state-set and never double-applies it. A
dropped browser connection SHALL NOT corrupt server state.

#### Scenario: Reconnecting client resumes the live stream

- **WHEN** a browser disconnects and reconnects
- **THEN** it SHALL be replayed the latest cached domain event per entity marked
  `replay: true`
- **AND** it SHALL then begin receiving subsequently-forwarded live events on the
  app-level channel

#### Scenario: Reconnecting client receives the latest cached state

- **WHEN** a browser connects (first connect or reconnect)
- **THEN** for every entity with a cached domain event, it SHALL receive
  `{ type: "ib_domain_event", sessionId, event: { eventType, data }, replay: true }`
  carrying that entity's latest event
- **AND** it SHALL then receive subsequently-forwarded live events on the same
  channel

#### Scenario: Latest state supersedes, no history log is replayed

- **WHEN** an invoice transitions through several states before a browser connects
- **THEN** the connecting browser SHALL receive exactly one replayed
  `ib_invoice_state_changed` frame for that invoice — its latest state
- **AND** it SHALL NOT receive the superseded intermediate states as replay frames

#### Scenario: Replayed frame is marked and live frame is not

- **WHEN** the server replays a cached domain event on connect
- **THEN** the frame SHALL carry `replay: true`
- **WHEN** the server broadcasts a live domain event
- **THEN** the frame SHALL NOT carry `replay: true` (the field is absent)

#### Scenario: Disconnect does not corrupt state

- **WHEN** a subscribed browser's connection drops mid-stream
- **THEN** the server SHALL continue broadcasting to the remaining browsers
  without error
- **AND** the retained latest-state cache SHALL be unaffected

## ADDED Requirements

### Requirement: Latest invoice domain-event state is cached with bounded memory

The server SHALL cache the latest `ib_domain_event` frame per entity key at the
same broadcast choke point that fans domain events to browsers. The key SHALL be
derived from the frame — `eventType` combined with the entity id read from
`event.data` (`invoice_id` for invoice lifecycle events, else the event's own
entity id, else the bare `eventType`) — because the envelope is not
invoice-addressed at the top level. The cache SHALL bound its memory by a hard
maximum entry count, evicting the oldest entry on overflow, and SHALL drop a
session's cached entries when that session is removed. Caching SHALL be a no-op
for a malformed frame (missing `sessionId`, `eventType`, or `data`) and SHALL
never throw on the broadcast path.

#### Scenario: Latest event per invoice is retained

- **WHEN** two `ib_invoice_state_changed` events for the same `invoice_id` are
  broadcast in order
- **THEN** the cache SHALL retain only the second (latest) frame for that invoice

#### Scenario: Distinct invoices are cached independently

- **WHEN** `ib_invoice_state_changed` events for two different `invoice_id`s are
  broadcast
- **THEN** the cache SHALL retain one latest frame per invoice

#### Scenario: Memory is bounded by entry count

- **WHEN** more than the maximum number of distinct entity keys are cached
- **THEN** the cache SHALL evict the oldest-inserted entry so its size never
  exceeds the maximum

#### Scenario: Session removal purges its cached events

- **WHEN** a session that produced cached domain events is removed
- **THEN** the cache SHALL drop the entries originating from that session

#### Scenario: Malformed frame is not cached

- **WHEN** a frame missing `sessionId`, `eventType`, or `data` reaches the
  broadcast choke point
- **THEN** the cache SHALL skip it without throwing
- **AND** a subsequent well-formed frame SHALL still be cached and broadcast

### Requirement: Domain-event broadcast emits a rate-limited success log

The server SHALL emit a rate-limited informational log entry on the
`ib_domain_event` broadcast path identifying the event type and entity, so an
operational incident is not misdiagnosed as "zero events" when the happy path is
simply unlogged. The log SHALL be sampled (not one line per event) and SHALL never
throw or block the broadcast.

#### Scenario: A broadcast domain event is observable in logs

- **WHEN** `ib_domain_event` frames are broadcast
- **THEN** at least one sampled informational log entry SHALL be produced
  identifying the event type
- **AND** logging SHALL never throw on the broadcast path
