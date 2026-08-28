## MODIFIED Requirements

### Requirement: App-level channel is reconnect-safe and delta-only

The app-level channel SHALL stream live deltas. In addition, the server SHALL
retain the **latest** `ib_domain_event` frame per entity key (the invoice, or the
event's own entity when it carries no invoice) and SHALL replay those retained
frames to a browser **on connect**, so a surface that mounts, re-fetches, or
reconnects after an event was emitted converges on current truth instead of
waiting for the next accidental delta.

The retained set for latest-per-key convergence SHALL be the latest event per key
only — the server SHALL NOT replay a full historical **log** of those events, and
SHALL NOT be responsible for out-of-band baseline snapshots. **Greeting-type
domain events are exempt from this latest-per-key retention**: they form a
chronological stream and are retained and replayed in order by the
`invoicebot-greeting-stream` capability rather than collapsed to their newest
entry. A replayed frame SHALL be distinguishable from a live frame by an additive
`replay: true` field (absent/false on live frames), so a consumer applies it as an
idempotent set and never double-applies it. A dropped browser connection SHALL NOT
corrupt server state.

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

#### Scenario: Greeting events are not collapsed by latest-per-key retention

- **WHEN** a session emits several greeting-type domain events before a browser
  connects
- **THEN** the latest-per-key convergence retention SHALL NOT reduce them to a
  single newest frame
- **AND** the connecting browser SHALL instead receive the ordered greeting stream
  as defined by the `invoicebot-greeting-stream` capability

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
