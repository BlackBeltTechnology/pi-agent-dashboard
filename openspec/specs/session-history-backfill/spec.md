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

The server SHALL clamp the requested range into the session's actual gap and the store's available range, and SHALL bound a single response to a maximum number of **events** (a count), never to a seq distance. Because the store may be holey — retention trims events while their seqs survive — a fixed seq span can enclose arbitrarily few events; the cap is therefore expressed and enforced as an event count so one response makes progress proportional to events, not to seq range.

#### Scenario: Oversized span is clamped

- **WHEN** a client requests a range whose stored events number more than the maximum event count
- **THEN** the server SHALL serve no more than the maximum event count
- **AND** the server SHALL NOT return an error for the clamp alone

#### Scenario: A sparse wide range is served in one response

- **WHEN** a client requests a range that spans a large seq distance but whose stored events number at or below the maximum event count
- **THEN** the server SHALL serve every stored event in that range in one response
- **AND** the server SHALL NOT refuse or truncate on the basis of the seq distance

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

The event store SHALL expose a range read bounded by both a minimum and a maximum seq, and SHALL expose a count-bounded read returning at most N of the highest-seq stored events at or below a given seq. Backfill SHALL be served exclusively from the store, never from disk, and SHALL NOT materialize the entire remaining gap in order to serve one bounded response.

#### Scenario: Range read returns only the requested range

- **WHEN** the store is asked for a range
- **THEN** it SHALL return exactly the stored events whose seq falls within that range, in ascending order

#### Scenario: Count-bounded read returns the newest events at or below a bound

- **WHEN** the store is asked for at most N events at or below a maximum seq, with a lower floor
- **THEN** it SHALL return the highest-seq stored events in `[floor, maxSeq]`, no more than N of them, in ascending order
- **AND** it SHALL NOT examine store entries in proportion to the seq distance of the range

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

The client SHALL stop issuing backfill requests for a session only when a response reports `remainingGapCount` of `0`. An empty `events` array with a positive `remainingGapCount` SHALL NOT be treated as exhaustion, SHALL NOT mark the gap unservable, and SHALL NOT resolve a head-free window to its floor terminus — it is a sparse or fully-superseded slice, and the walk continues. On exhaustion: a head-free window SHALL resolve to a terminal state; a two-sided window whose loaded region is contiguous SHALL remove the affordance; a two-sided window whose middle was trimmed (holey) SHALL resolve to a terminal state rather than disappearing, so the elision is not silently erased.

#### Scenario: Empty response with a remaining gap continues the walk

- **WHEN** a backfill response returns an empty `events` array and reports `remainingGapCount` greater than `0`
- **THEN** the client SHALL keep the affordance available and armed
- **AND** the client SHALL NOT mark the gap unservable
- **AND** the client SHALL NOT present a head-free floor terminus

#### Scenario: Exhausted two-sided gap removes the affordance

- **WHEN** a backfill response reports `remainingGapCount` of `0`, the window has a head segment, and the loaded region is contiguous (the announced gap held as many events as its seq span)
- **THEN** the client SHALL stop offering to load earlier events for that session
- **AND** the interstitial SHALL be removed from the transcript

#### Scenario: Exhausted holey two-sided gap resolves to a not-retained terminus

- **WHEN** a backfill response reports `remainingGapCount` of `0`, the window has a head segment, and the announced gap was holey (it held fewer events than its seq span, so retention trimmed its middle)
- **THEN** the interstitial SHALL resolve to a terminal state disclosing that earlier events are no longer retained
- **AND** it SHALL NOT be removed, because removing it would render the head and tail as if they were adjacent

#### Scenario: Exhausted head-free gap resolves to a terminus

- **WHEN** a backfill response reports `remainingGapCount` of `0` and the window has no head segment
- **THEN** the loading head SHALL be replaced by a terminal state
- **AND** it SHALL NOT be removed, because nothing above it would explain where the transcript begins

### Requirement: Backfill fills the gap from the tail edge inward

The client SHALL request the full remaining gap range up to the tail edge — `fromSeq` at the gap floor (`headMaxSeq + 1`, or the announced store floor in a head-free window) and `toSeq` at `tailMinSeq - 1` — so that the server, applying its event-count cap, delivers the events nearest what the user is already reading and successive requests converge on the head. Each response SHALL retreat the tail edge to the lowest served seq.

#### Scenario: First request abuts the tail

- **WHEN** the client issues its first backfill request for an announced gap
- **THEN** the requested `toSeq` SHALL be `tailMinSeq - 1`

#### Scenario: Each request spans the full remaining gap

- **WHEN** the client issues any backfill request for an announced gap
- **THEN** the requested `fromSeq` SHALL be the gap floor and the requested `toSeq` SHALL be `tailMinSeq - 1`

#### Scenario: Successive requests walk downward

- **WHEN** a backfill response retreats the gap's tail edge
- **THEN** the next request's `toSeq` SHALL be below the previous response's served lower bound

#### Scenario: Final request is floored at the head

- **WHEN** the remaining gap holds fewer events than the maximum event count
- **THEN** the requested `fromSeq` SHALL be no lower than the gap floor
- **AND** the response SHALL serve the remainder, except that a message-boundary snap MAY defer the last event to one further request, so the walk terminates once a response reports `remainingGapCount` of `0`

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

The server SHALL snap a backfill slice's gap-facing edge inward to a message boundary within a bounded lookup, so a splice does not end mid-message. The gap-facing edge SHALL be determined by the request's orientation — the lower edge for a tail-adjacent request, the upper edge for a head-adjacent one. The snap SHALL only shrink the served range, and the credited edge SHALL be derived from the served bounds after snapping. Where a served range is bounded, it is bounded by the maximum event count, never by a seq distance.

#### Scenario: Gap-facing edge snaps inward

- **WHEN** the computed gap-facing edge falls in the middle of a message and a boundary exists within the lookup bound
- **THEN** the served events SHALL end at that boundary

#### Scenario: Orientation determines which edge is snapped

- **WHEN** a head-adjacent range is served
- **THEN** its upper edge SHALL be the snapped edge

#### Scenario: A count clamp preserves adjacency

- **WHEN** a requested range holds more events than the maximum event count and abuts the tail edge
- **THEN** the served range SHALL still end at `tailMinSeq - 1`
- **AND** the served range's lower bound SHALL be raised to the seq of the (maximum-count)-th newest event so the response holds no more than the maximum event count
- **AND** the tail edge SHALL be credited

#### Scenario: A count clamp on a head-adjacent range preserves its adjacency

- **WHEN** a requested range holds more events than the maximum event count and abuts the head edge
- **THEN** the served range SHALL still begin at `headMaxSeq + 1`
- **AND** the served range's upper bound SHALL be lowered so the response holds no more than the maximum event count

#### Scenario: Snap never grows the slice

- **WHEN** a slice edge is snapped
- **THEN** the number of served events SHALL be no greater than it would have been without the snap
- **AND** SHALL NOT exceed the maximum event count

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

### Requirement: A head-free window bounds the gap at the store floor

When the replay window has no head segment, the elided region SHALL be bounded above by the tail and below by the lowest seq the store can still serve. The client SHALL NOT request a range below that floor, and SHALL treat reaching it — signalled by `remainingGapCount` of `0` — as completion rather than as failure. An empty slice above a floor that still has events remaining SHALL NOT be treated as reaching the floor.

#### Scenario: Backfill walks down to the store floor

- **WHEN** a `tail-only` window is announced with a gap and the client backfills repeatedly
- **THEN** each request SHALL span from the announced floor up to the current tail edge
- **AND** no request SHALL specify a lower bound below the announced floor

#### Scenario: Reaching the floor is a terminus, not an unservable gap

- **WHEN** the client has loaded every event the store holds in a head-free gap and the response reports `remainingGapCount` of `0`
- **THEN** the top row SHALL present a terminal state rather than a loading affordance
- **AND** that state SHALL NOT be presented as an error or as a transient failure

#### Scenario: The terminus distinguishes the session start from a trimmed history

- **WHEN** the loaded region reaches seq `1`
- **THEN** the terminal state SHALL state that the beginning of the session has been reached
- **WHEN** the loaded region reaches a floor greater than seq `1`
- **THEN** the terminal state SHALL state that earlier events are no longer retained

#### Scenario: An empty response above a non-empty floor is not the terminus

- **WHEN** a backfill response in a head-free window returns no events but reports `remainingGapCount` greater than `0`
- **THEN** the client SHALL keep the loading affordance rather than presenting the terminus

#### Scenario: An empty final response is not reported as unservable

- **WHEN** a backfill response returns no events and reports `remainingGapCount` of `0` in a head-free window
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

### Requirement: The server serves the newest events within the requested range, bounded by a maximum count

The server SHALL answer a backfill request by selecting the highest-seq stored events at or below the requested `toSeq` and at or above the requested `fromSeq`, no more than the maximum event count, and SHALL retreat the tail edge to the lowest seq it served. This makes a single response close a gap whose events number at or below the cap regardless of how wide the gap's seq span is, and it bounds the work of one response to the cap rather than to the gap's seq distance.

#### Scenario: A range richer than the cap serves the newest events

- **WHEN** the stored events inside the requested range number more than the maximum event count
- **THEN** the server SHALL serve the highest-seq events up to the cap
- **AND** `servedFrom` SHALL be the lowest seq of the SELECTED slice — the slice chosen before replay compaction drops superseded events — not the lowest DELIVERED event, so a fully-superseded slice that delivers no events still retreats the tail
- **AND** `servedTo` SHALL bound the highest selected seq
- **AND** the recorded `tailMinSeq` SHALL become `servedFrom`

#### Scenario: A fully-superseded slice still retreats the tail

- **WHEN** the selected slice's events are all superseded and replay compaction drops every one, so the response delivers an empty `events` array
- **THEN** `servedFrom` SHALL still be the selected slice's lowest seq
- **AND** the recorded `tailMinSeq` SHALL retreat to it
- **AND** `remainingGapCount` SHALL reflect the retreated edge, so the next request covers a strictly smaller range and the walk cannot livelock

#### Scenario: A holey gap within the cap is served in one response

- **WHEN** the stored events inside a wide requested range number at or below the maximum event count
- **THEN** the server SHALL serve all of them in one response, except that a message-boundary snap MAY hold back the lowest events to one further request
- **AND** when no snap holds events back, the response SHALL report `remainingGapCount` of `0`
- **AND** when a snap holds events back, `remainingGapCount` SHALL be positive and the next request SHALL serve the remainder

#### Scenario: Serving does not scan the whole gap

- **WHEN** the requested range spans a large seq distance but the cap is small
- **THEN** the number of store entries examined to build the response SHALL be bounded by the cap and the message-boundary lookup, not by the range's seq distance

### Requirement: A two-sided terminus discloses a trimmed middle without error presentation

When a two-sided (head segment present) gap is exhausted, the client SHALL classify whether the announced gap was contiguous or holey and present accordingly. The gap is holey when the announced event count was fewer than its seq span (`gapCount < tailMinSeq − headMaxSeq − 1`), computed from the announced window without any additional request. This classification applies ONLY to a two-sided window; a head-free window resolves through its own store-floor terminus and SHALL NOT be classified by this formula (with no head segment the formula would misread a trimmed BEGINNING as a trimmed middle). A holey gap's terminus SHALL disclose that earlier events are no longer retained, reusing the head-free not-retained presentation, and SHALL NOT be shown as an error.

#### Scenario: Holeyness is derived from the announced window

- **WHEN** a windowed replay announces a two-sided gap
- **THEN** the client SHALL determine holeyness from the announced event count and seq bounds alone
- **AND** it SHALL NOT issue any request solely to determine holeyness

#### Scenario: The two-sided terminus is not an error

- **WHEN** a holey two-sided gap resolves to its terminus
- **THEN** it SHALL NOT use error presentation
- **AND** it SHALL NOT offer a retry

#### Scenario: A contiguous exhausted gap shows no terminus

- **WHEN** an exhausted two-sided gap was contiguous
- **THEN** the client SHALL remove the interstitial rather than showing a terminus
