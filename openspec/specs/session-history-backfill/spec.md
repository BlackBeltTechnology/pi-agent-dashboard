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

The client SHALL insert backfilled events at their seq-ordered position within the elided region, adjacent to the segment the served range abuts, and SHALL NOT treat them as a replay or a reset. The splice SHALL NOT presume a head segment exists.

#### Scenario: Splice does not reset transcript state

- **WHEN** a backfill response is applied
- **THEN** the existing rows SHALL remain present
- **AND** the transcript SHALL NOT be rebuilt from scratch

#### Scenario: Splice preserves scroll position

- **WHEN** backfilled events are spliced into the transcript
- **THEN** the content the user is currently viewing SHALL remain at the same visual position

#### Scenario: Splice into a head-free gap lands below the loading head

- **WHEN** the window has no head segment and a backfill response is applied
- **THEN** the spliced rows SHALL be placed directly below the loading head
- **AND** the loading head SHALL remain the transcript's first row

#### Scenario: Tail-anchored events land adjacent to the tail

- **WHEN** a backfill response carrying the events immediately below the tail edge is applied
- **THEN** those events SHALL be inserted between the gap divider and the first tail row

#### Scenario: Measurement of spliced rows does not move the viewport

- **WHEN** the virtualizer measures the spliced rows and their measured heights differ from the estimates
- **THEN** the divider SHALL remain at the same visual position

#### Scenario: Splice does not re-pin the view to the bottom

- **WHEN** a backfill response is applied while the user is scrolled up, including when the divider sits within the near-bottom threshold
- **THEN** the transcript SHALL NOT scroll to the bottom

#### Scenario: A two-sided splice does not trigger the selection-anchor correction

- **WHEN** a backfill response is applied in `head-tail` while a text selection is held in the transcript
- **THEN** no selection-anchor scroll correction SHALL be applied for that commit

#### Scenario: A head-free splice keeps the selection anchored

- **WHEN** a backfill response is applied in `tail-only` while a text selection is held in the transcript
- **THEN** the selection-anchor correction SHALL remain active for that commit
- **AND** the selected row SHALL keep its viewport position while the head fills
- **AND** the retained selection's row-index span SHALL be remapped across the splice so the selected row stays mounted

#### Scenario: Splice leaves live-event bookkeeping untouched

- **WHEN** a backfill response is applied
- **THEN** the session's live-event high-water mark SHALL NOT change
- **AND** the backfilled events SHALL NOT be published to the plugin-runtime event store
- **AND** the backfilled events SHALL NOT be written to the durable replay cache

#### Scenario: A response with no place to splice changes nothing

- **WHEN** a backfill response arrives for a session whose gap row is not present in the transcript
- **THEN** the client SHALL NOT advance its gap bookkeeping
- **AND** the transcript SHALL be left unchanged

### Requirement: The backfill affordance arms only after replay completes

The client SHALL NOT issue a backfill request for a session until that session's initial replay has terminated.

#### Scenario: No backfill during hydration

- **WHEN** a session is still hydrating and its replay has not delivered a terminal batch
- **THEN** the client SHALL NOT issue a `history_backfill` request for it

### Requirement: The client stops requesting when the gap is exhausted

The client SHALL stop issuing backfill requests for a session when a response returns no events or reports no remaining gap, regardless of the reason. In a window with a head segment the affordance SHALL be removed; in a head-free window it SHALL resolve to a terminal state rather than disappearing.

#### Scenario: Empty response with a remaining gap continues the walk

- **WHEN** a backfill response returns an empty `events` array
- **THEN** the client SHALL NOT immediately issue another request for the same range

#### Scenario: Exhausted two-sided gap removes the affordance

- **WHEN** a backfill response reports `remainingGapCount` of `0` and the window has a head segment
- **THEN** the client SHALL stop offering to load earlier events for that session
- **AND** the interstitial SHALL be removed from the transcript

#### Scenario: Exhausted head-free gap resolves to a terminus

- **WHEN** a backfill response reports `remainingGapCount` of `0` and the window has no head segment
- **THEN** the loading head SHALL be replaced by a terminal state
- **AND** it SHALL NOT be removed, because nothing above it would explain where the transcript begins

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

#### Scenario: A count clamp preserves adjacency

- **WHEN** a requested range exceeds the maximum span and abuts the tail edge
- **THEN** the served range SHALL still end at `tailMinSeq - 1`
- **AND** the served range's lower bound SHALL be raised to satisfy the span limit
- **AND** the tail edge SHALL be credited

#### Scenario: A count clamp on a head-adjacent range preserves its adjacency

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

When the gap exists but the store can no longer serve it, the divider SHALL make clear that the earlier events cannot be loaded at all, rather than appearing to be a transient failure. Its wording SHALL remain truthful about the CAUSE whether the events were dropped by retention or removed by replay compaction, since the client cannot distinguish the two. The client MAY distinguish whether anything remains below the loaded region, which is a question about the store floor rather than about cause. It SHALL NOT be presented as an error.

#### Scenario: Unservable divider states the outcome without attributing a single cause

- **WHEN** the gap cannot be served
- **THEN** the divider SHALL state that the earlier events cannot be loaded
- **AND** it SHALL NOT attribute the loss to retention specifically or to compaction specifically
- **AND** it SHALL NOT be styled or announced as an error

#### Scenario: Unservable is not an error

- **WHEN** the divider is unservable
- **THEN** it SHALL NOT use error presentation
- **AND** it SHALL NOT offer a retry

#### Scenario: Reaching the floor is reported without claiming a cause

- **WHEN** a head-free window has loaded everything the store holds and the floor is above seq `1`
- **THEN** the terminal state SHALL report that earlier events are not retained
- **AND** it SHALL NOT name retention or compaction as the specific reason

### Requirement: A head-free window bounds the gap at the store floor

When the replay window has no head segment, the elided region SHALL be bounded above by the tail and below by the lowest seq the store can still serve. The client SHALL NOT request a range below that floor, and SHALL treat reaching it as completion rather than as failure.

#### Scenario: Backfill walks down to the store floor

- **WHEN** a `tail-only` window is announced with a gap and the client backfills repeatedly
- **THEN** each request SHALL cover the range immediately below the region already loaded
- **AND** no request SHALL specify a lower bound below the announced floor

#### Scenario: Reaching the floor is a terminus, not an unservable gap

- **WHEN** the client has loaded every event the store holds in a head-free gap
- **THEN** the top row SHALL present a terminal state rather than a loading affordance
- **AND** that state SHALL NOT be presented as an error or as a transient failure

#### Scenario: The terminus distinguishes the session start from a trimmed history

- **WHEN** the loaded region reaches seq `1`
- **THEN** the terminal state SHALL state that the beginning of the session has been reached
- **WHEN** the loaded region reaches a floor greater than seq `1`
- **THEN** the terminal state SHALL state that earlier events are no longer retained

#### Scenario: An empty final response is not reported as unservable

- **WHEN** a backfill response returns no events and reports no remaining gap in a head-free window
- **THEN** the client SHALL present the terminus
- **AND** the client SHALL NOT present the gap as unable to be loaded

### Requirement: Edge crediting never credits an absent head

The server SHALL credit a served range to the segment it genuinely abuts. When the window has no head segment, a served range SHALL NOT advance a head bound, even when its lower bound equals one greater than the recorded head value.

#### Scenario: The lowest slice of a head-free gap does not create a head

- **WHEN** the window has no head segment, the recorded head bound is `0`, and a client requests a range beginning at seq `1`
- **THEN** the server SHALL credit the tail bound rather than the head bound
- **AND** the reported remaining gap count SHALL continue to reflect what the store still holds

### Requirement: A head-free gap loads on scroll proximity

When the window has no head segment, the client SHALL request the next range automatically as the user scrolls the loading head into proximity, without requiring an explicit activation. The automatic trigger SHALL be subject to every guard that governs an explicit request, SHALL issue at most one request at a time, and SHALL NOT fire while the initial replay is still in flight.

#### Scenario: Scrolling to the loading head loads the next range

- **WHEN** the user scrolls until the loading head is within the proximity threshold and a servable gap remains
- **THEN** the client SHALL issue exactly one `history_backfill` request

#### Scenario: The trigger respects the arming rule

- **WHEN** the initial replay for the session has not terminated
- **THEN** the trigger SHALL NOT issue a request regardless of scroll position

#### Scenario: The trigger does not stack requests

- **WHEN** a request is already in flight and the loading head remains within the proximity threshold
- **THEN** the client SHALL NOT issue a second request until the first has settled

#### Scenario: The trigger does not fire on first paint

- **WHEN** a windowed replay terminates and the transcript's initial position already places the loading head within the proximity threshold
- **THEN** the client SHALL NOT issue a request until the user has scrolled

#### Scenario: The trigger yields during an active touch gesture

- **WHEN** the loading head enters the proximity threshold during an in-progress touch or momentum scroll
- **THEN** the client SHALL defer the request until the gesture has settled

#### Scenario: A refused or exhausted gap disarms the trigger

- **WHEN** the gap is exhausted, unservable, or the last request was refused
- **THEN** the trigger SHALL NOT re-fire automatically
- **AND** any remaining affordance SHALL require an explicit user activation

### Requirement: The explicit affordance remains available

An explicit activation SHALL remain the only load path when the window has a head segment, and SHALL remain available as a fallback whenever the automatic trigger is disarmed.

#### Scenario: A two-sided gap is click-to-load only

- **WHEN** the window has a head segment
- **THEN** the client SHALL NOT load the gap automatically on scroll

#### Scenario: A failed automatic request falls back to explicit retry

- **WHEN** an automatically issued request is refused
- **THEN** the loading head SHALL offer an explicit retry

