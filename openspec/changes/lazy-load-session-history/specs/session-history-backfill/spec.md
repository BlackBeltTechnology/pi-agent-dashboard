## ADDED Requirements

### Requirement: The client can request an explicit seq range from the elided middle

The system SHALL provide a `history_backfill` request carrying `sessionId`, `fromSeq`, and `toSeq`, and SHALL answer it with a `history_backfill_result` carrying the served events, `servedFrom`, `servedTo`, and `remainingGapCount`.

#### Scenario: Range inside the gap is served

- **WHEN** a subscribed client requests a range that lies inside the announced gap and is present in the store
- **THEN** the server SHALL respond with the events in that range in ascending seq order
- **AND** `servedFrom` and `servedTo` SHALL bound the returned events

#### Scenario: Response events fall strictly inside the gap

- **WHEN** the server answers a backfill request
- **THEN** every returned event seq SHALL be greater than `headMaxSeq` and less than `tailMinSeq` of the announced window

### Requirement: Every backfill request receives exactly one response

The server SHALL emit exactly one `history_backfill_result` per `history_backfill` request, including for every refusal, so a request can never leave the client waiting.

#### Scenario: Refusal still produces a response

- **WHEN** a backfill request is refused for any reason
- **THEN** the client SHALL receive one `history_backfill_result` carrying an `error` code and an empty `events` array

#### Scenario: Unsubscribed session is refused

- **WHEN** a client requests backfill for a session it is not subscribed to
- **THEN** the server SHALL respond with `error` of `not_subscribed`
- **AND** the server SHALL NOT read events for that session

#### Scenario: Second concurrent request is refused

- **WHEN** a client issues a second backfill request for a session while its first is still in flight
- **THEN** the server SHALL respond to the second with `error` of `in_flight`
- **AND** the first request SHALL still receive its own response

### Requirement: The server clamps every client-supplied bound

The server SHALL clamp the requested span to a maximum, and SHALL clamp the requested range into the session's actual gap and the store's available range.

#### Scenario: Oversized span is clamped

- **WHEN** a client requests a range spanning more events than the maximum span
- **THEN** the server SHALL serve no more than the maximum span
- **AND** the server SHALL NOT return an error for the clamp alone

#### Scenario: Range wholly outside the gap is refused

- **WHEN** a client requests a range that does not intersect the announced gap
- **THEN** the server SHALL respond with `error` of `out_of_range` and an empty `events` array

#### Scenario: Inverted range is refused

- **WHEN** a client requests a range whose `fromSeq` exceeds its `toSeq`
- **THEN** the server SHALL respond with `error` of `out_of_range` and an empty `events` array

### Requirement: A stale backfill response is refused rather than dropped

Each subscription SHALL carry a generation counter incremented on every subscribe. When the generation at completion differs from the generation at request time, the server SHALL respond with `error` of `stale_generation` rather than silently discarding the response.

#### Scenario: Resubscribe invalidates an in-flight backfill

- **WHEN** a client unsubscribes and re-subscribes to a session while a backfill is in flight
- **THEN** the client SHALL receive a `history_backfill_result` carrying `error` of `stale_generation`
- **AND** no event from that response SHALL be inserted into the transcript

### Requirement: Backfill is served from the event store through a bounded range read

The event store SHALL expose a range read bounded by both a minimum and a maximum seq, and backfill SHALL be served exclusively from the store, never from disk.

#### Scenario: Range read returns only the requested range

- **WHEN** the store is asked for a range
- **THEN** it SHALL return exactly the stored events whose seq falls within that range, in ascending order

#### Scenario: Backfill triggers no session file read

- **WHEN** a backfill request is served
- **THEN** the server SHALL NOT read the session transcript file

### Requirement: Backfill responses are compacted against the full stream's supersession boundary

Backfill responses SHALL have tool results truncated and superseded streaming updates dropped, using a supersession boundary derived from the full stream rather than from the slice.

#### Scenario: Superseded updates do not re-enter through backfill

- **WHEN** a backfill range contains `message_update` events whose `message_end` lies outside the range in the already-delivered tail
- **THEN** those updates SHALL NOT be present in the response, except for the documented exemptions

#### Scenario: Exempt updates survive backfill compaction

- **WHEN** a backfill range contains a thinking update, or the last text-bearing update preceding a `tool_execution_start`
- **THEN** that update SHALL be present in the response

### Requirement: The client splices backfilled events into the gap

The client SHALL insert backfilled events at their seq-ordered position between the head and tail segments, and SHALL NOT treat them as a replay or a reset.

#### Scenario: Splice does not reset transcript state

- **WHEN** a backfill response is applied
- **THEN** the existing head and tail rows SHALL remain present
- **AND** the transcript SHALL NOT be rebuilt from scratch

#### Scenario: Splice preserves scroll position

- **WHEN** backfilled events are spliced into the transcript
- **THEN** the content the user is currently viewing SHALL remain at the same visual position

#### Scenario: Splice leaves live-event bookkeeping untouched

- **WHEN** a backfill response is applied
- **THEN** the session's live-event high-water mark SHALL NOT change
- **AND** the backfilled events SHALL NOT be published to the plugin-runtime event store
- **AND** the backfilled events SHALL NOT be written to the durable replay cache

### Requirement: The backfill affordance arms only after replay completes

The client SHALL NOT issue a backfill request for a session until that session's initial replay has terminated.

#### Scenario: No backfill during hydration

- **WHEN** a session is still hydrating and its replay has not delivered a terminal batch
- **THEN** the client SHALL NOT issue a `history_backfill` request for it

### Requirement: The client stops requesting when the gap is exhausted

The client SHALL stop issuing backfill requests for a session when a response returns no events or reports no remaining gap, regardless of the reason.

#### Scenario: Empty response terminates the loop

- **WHEN** a backfill response returns an empty `events` array
- **THEN** the client SHALL NOT immediately issue another request for the same range

#### Scenario: Exhausted gap removes the affordance

- **WHEN** a backfill response reports `remainingGapCount` of `0`
- **THEN** the client SHALL stop offering to load earlier events for that session
