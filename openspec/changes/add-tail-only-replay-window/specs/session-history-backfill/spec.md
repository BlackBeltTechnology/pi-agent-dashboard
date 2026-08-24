<!--
ORDERING: these deltas assume `fix-lazy-history-backfill-ux` is archived FIRST.
The MODIFIED block for "An unservable gap explains that the events are not
recoverable" targets a requirement that change ADDS; archiving in the other
order will fail to locate it.
-->

## ADDED Requirements

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

## MODIFIED Requirements

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

#### Scenario: Splice leaves live-event bookkeeping untouched

- **WHEN** a backfill response is applied
- **THEN** the session's live-event high-water mark SHALL NOT change
- **AND** the backfilled events SHALL NOT be published to the plugin-runtime event store
- **AND** the backfilled events SHALL NOT be written to the durable replay cache

#### Scenario: A response with no place to splice changes nothing

- **WHEN** a backfill response arrives for a session whose gap row is not present in the transcript
- **THEN** the client SHALL NOT advance its gap bookkeeping
- **AND** the transcript SHALL be left unchanged

### Requirement: The client stops requesting when the gap is exhausted

The client SHALL stop issuing backfill requests for a session when a response returns no events or reports no remaining gap, regardless of the reason. In a window with a head segment the affordance SHALL be removed; in a head-free window it SHALL resolve to a terminal state rather than disappearing.

#### Scenario: Empty response terminates the loop

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

### Requirement: An unservable gap explains that the events are not recoverable

When the gap exists but the store can no longer serve it, the divider SHALL make clear that the earlier events cannot be loaded at all, rather than appearing to be a transient failure. Its wording SHALL remain truthful about the CAUSE whether the events were dropped by retention or removed by replay compaction, since the client cannot distinguish the two. The client MAY distinguish whether anything remains below the loaded region, which is a question about the store floor rather than about cause. It SHALL NOT be presented as an error.

#### Scenario: Unservable divider states the outcome without attributing a single cause

- **WHEN** the gap cannot be served
- **THEN** the divider SHALL state that the earlier events cannot be loaded
- **AND** it SHALL NOT attribute the loss to retention specifically or to compaction specifically
- **AND** it SHALL NOT be styled or announced as an error

#### Scenario: Reaching the floor is reported without claiming a cause

- **WHEN** a head-free window has loaded everything the store holds and the floor is above seq `1`
- **THEN** the terminal state SHALL report that earlier events are not retained
- **AND** it SHALL NOT name retention or compaction as the specific reason
