# session-history-backfill Specification

## Purpose
TBD - created by archiving change lazy-load-session-history. Update Purpose after archive.
## Requirements
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

The client SHALL insert backfilled events at their seq-ordered position between the head and tail segments, and SHALL NOT treat them as a replay or a reset. Tail-anchored events SHALL be placed immediately below the gap divider, adjacent to the tail segment. Because the segment is reduced from a fresh state, only its rows SHALL be merged into session state.

#### Scenario: Splice does not reset transcript state

- **WHEN** a backfill response is applied
- **THEN** the existing head and tail rows SHALL remain present
- **AND** the transcript SHALL NOT be rebuilt from scratch

#### Scenario: Tail-anchored events land adjacent to the tail

- **WHEN** a backfill response carrying the events immediately below the tail edge is applied
- **THEN** those events SHALL be inserted between the gap divider and the first tail row

#### Scenario: Splice preserves scroll position

- **WHEN** backfilled events are spliced into the transcript below the divider
- **THEN** the scroll offset of the content above the insertion point SHALL be unchanged
- **AND** the divider SHALL remain at the same visual position
- **AND** no scroll correction SHALL be applied on the basis of the change in total content height

#### Scenario: Measurement of spliced rows does not move the viewport

- **WHEN** the virtualizer measures the spliced rows and their measured heights differ from the estimates
- **THEN** the divider SHALL remain at the same visual position

#### Scenario: Splice does not re-pin the view to the bottom

- **WHEN** a backfill response is applied while the user is scrolled up, including when the divider sits within the near-bottom threshold
- **THEN** the transcript SHALL NOT scroll to the bottom

#### Scenario: Splice does not trigger the selection-anchor correction

- **WHEN** a backfill response is applied while a text selection is held in the transcript
- **THEN** no selection-anchor scroll correction SHALL be applied for that commit

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

### Requirement: Backfill fills the gap from the tail edge inward

The client SHALL request the range immediately below the gap's tail edge, so that each backfill delivers the events nearest to what the user is already reading and successive requests converge on the head.

#### Scenario: First request abuts the tail

- **WHEN** the client issues its first backfill request for an announced gap
- **THEN** the requested `toSeq` SHALL be `tailMinSeq - 1`

#### Scenario: Successive requests walk downward

- **WHEN** a backfill response retreats the gap's tail edge
- **THEN** the next request's `toSeq` SHALL be below the previous request's `fromSeq`

#### Scenario: Final request is floored at the head

- **WHEN** the remaining gap spans fewer events than the maximum span
- **THEN** the requested `fromSeq` SHALL be no lower than `headMaxSeq + 1`

### Requirement: The server credits whichever gap edge the served range abuts

The server SHALL track both gap edges as mutable. A served range adjacent to the head edge SHALL advance it; a served range adjacent to the tail edge SHALL retreat it; a range adjacent to neither SHALL be served without moving either edge. Crediting SHALL be exclusive — at most one edge moves per response.

#### Scenario: Tail-adjacent range retreats the tail edge

- **WHEN** a served range ends at `tailMinSeq - 1`
- **THEN** the recorded `tailMinSeq` SHALL become the served range's lower bound

#### Scenario: Head-adjacent range still advances the head edge

- **WHEN** a served range begins at `headMaxSeq + 1` and does not end at `tailMinSeq - 1`
- **THEN** the recorded `headMaxSeq` SHALL become the served range's upper bound

#### Scenario: A range abutting both edges credits the tail

- **WHEN** a served range both begins at `headMaxSeq + 1` and ends at `tailMinSeq - 1`
- **THEN** the recorded `tailMinSeq` SHALL become the served range's lower bound
- **AND** the recorded `headMaxSeq` SHALL be unchanged

#### Scenario: Interior range moves neither edge

- **WHEN** a served range abuts neither edge of the gap
- **THEN** the recorded `headMaxSeq` and `tailMinSeq` SHALL both be unchanged
- **AND** the events SHALL still be returned

#### Scenario: Remaining count reflects the moved edge

- **WHEN** either gap edge moves
- **THEN** `remainingGapCount` SHALL report the number of events the store still holds strictly between the two current edges

### Requirement: A backfill slice ends on a message boundary at its gap-facing edge

The server SHALL snap a backfill slice's gap-facing edge inward to a message boundary within a bounded lookup, so a splice does not end mid-message. The gap-facing edge SHALL be determined by the request's orientation — the lower edge for a tail-adjacent request, the upper edge for a head-adjacent one. The snap SHALL only shrink the served range, and the credited edge SHALL be derived from the served bounds after snapping.

#### Scenario: Gap-facing edge snaps inward

- **WHEN** the computed gap-facing edge falls in the middle of a message and a boundary exists within the lookup bound
- **THEN** the served events SHALL end at that boundary

#### Scenario: Orientation determines which edge is snapped

- **WHEN** a head-adjacent range is served
- **THEN** its upper edge SHALL be the snapped edge

#### Scenario: A span clamp preserves adjacency

- **WHEN** a requested range exceeds the maximum span and abuts the tail edge
- **THEN** the served range SHALL still end at `tailMinSeq - 1`
- **AND** the served range's lower bound SHALL be raised to satisfy the span limit
- **AND** the tail edge SHALL be credited

#### Scenario: A span clamp on a head-adjacent range preserves its adjacency

- **WHEN** a requested range exceeds the maximum span and abuts the head edge
- **THEN** the served range SHALL still begin at `headMaxSeq + 1`
- **AND** the served range's upper bound SHALL be lowered to satisfy the span limit

#### Scenario: Snap never grows the slice

- **WHEN** a slice edge is snapped
- **THEN** the number of served events SHALL be no greater than it would have been without the snap
- **AND** SHALL NOT exceed the maximum span

#### Scenario: No boundary within the lookup leaves the raw cut

- **WHEN** no message boundary exists within the lookup bound
- **THEN** the server SHALL serve the unsnapped range

#### Scenario: Snapping to empty is refused

- **WHEN** snapping would reduce the slice to zero events
- **THEN** the server SHALL serve the unsnapped range instead
- **AND** the response SHALL NOT report an exhausted gap on that basis

#### Scenario: The credited edge matches what was served

- **WHEN** a slice is snapped and its edge is credited
- **THEN** the recorded edge SHALL equal the served bound, not the pre-snap bound

### Requirement: An unservable gap explains that the events are not recoverable

When the gap exists but the store can no longer serve it, the divider SHALL make clear that the earlier events cannot be loaded at all, rather than appearing to be a transient failure. Its wording SHALL remain truthful whether the events were dropped by retention or removed by replay compaction, since the client cannot distinguish the two. It SHALL NOT be presented as an error.

#### Scenario: Unservable divider states the outcome without attributing a single cause

- **WHEN** the divider enters its unservable state
- **THEN** it SHALL indicate that the earlier events are no longer available to load
- **AND** it SHALL NOT attribute the loss specifically to event retention

#### Scenario: Unservable is not an error

- **WHEN** the divider is unservable
- **THEN** it SHALL NOT use error presentation
- **AND** it SHALL NOT offer a retry

