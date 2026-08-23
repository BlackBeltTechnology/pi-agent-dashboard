## ADDED Requirements

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

## MODIFIED Requirements

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
