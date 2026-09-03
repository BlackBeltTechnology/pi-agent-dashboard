## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: An unservable gap explains that the events are not recoverable

**Reason**: The mid-walk `unservable` divider state (A5) is retired. Under count-bounded serving with termination keyed on `remainingGapCount` only, an empty response with a positive `remainingGapCount` keeps the affordance armed (the walk continues), and every exhaustion (`remainingGapCount === 0`) resolves to a classified terminus — session-start or not-retained for a head-free window, not-retained for a holey two-sided gap — or removes the affordance for a contiguous two-sided gap. No path produces the cause-agnostic "these earlier messages cannot be loaded" divider, so a requirement describing it has no reachable trigger.

**Migration**: The exhaustion disclosure is governed by "A head-free window bounds the gap at the store floor" (head-free floor terminus) and "A two-sided terminus discloses a trimmed middle without error presentation" (two-sided holey terminus). Both reuse the not-retained wording and both assert the not-an-error / no-retry qualities the removed requirement carried. Server refusals remain the separate `failed` state, which offers a retry and is unaffected.
