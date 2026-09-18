## MODIFIED Requirements

### Requirement: Auto-scroll robust to multi-batch event replay
When the chat view scrolls programmatically (on session switch in the "near bottom" branch, or when new content arrives while the user is at the bottom), the resulting `onScroll` event SHALL NOT cause the view to register that the user has scrolled away from the bottom. The auto-scroll chase SHALL continue across every subsequent `event_replay` batch until either replay completes or the user performs a real scroll gesture. The auto-scroll bottom-pin (both the `stickToBottom` follow effect and the virtualizer `onChange` re-pin) SHALL additionally be suspended while an active transcript selection is held, and SHALL resume on selection collapse without clearing the underlying at-bottom follow state.

Robustness SHALL NOT depend on a scroll event arriving inside a fixed time
window. A bottom-pin write is necessarily clamped to the scroll extent that
exists at write time; rows below the viewport may then measure in and grow the
scroll extent before the induced scroll event is dispatched. Such an event
reports a position far from the bottom despite no user gesture, and SHALL NOT be
treated as the user scrolling away, regardless of how long the measurement took.

Therefore the chat view SHALL be able to attribute a scroll event to the
programmatic write that caused it. A scroll event attributed to a bottom-pin
write SHALL preserve the follow state when it is consistent with a measurement
clamp — that is, it matches the position the pin actually achieved and the
content has grown since — and SHALL otherwise fall through to the normal
position rules.

Attribution SHALL NOT survive a genuine escape gesture, by either of two paths:
real user input (wheel, touch) SHALL clear it directly, and any scroll event that
moves the view off the position the pin achieved — which is what a scrollbar drag
or a keyboard scroll does — SHALL fail the clamp test and fall through to the
normal position rules. Attribution SHALL be consumed by the first scroll event it
is tested against: an event that falls through SHALL clear it, so a recorded pin
cannot be re-matched by a later, unrelated event that happens to land on the same
position. Every programmatic write that pins to the bottom SHALL claim attribution —
including the session-switch write taken when the outgoing position was near the
bottom or the session is opened for the first time, which is the write the
"opens at the latest message" behavior depends on. Programmatic writes that are
deliberate jumps rather than bottom-pins (scroll-to-bottom button, jump-to-turn,
restore to a saved position, splice corrections) SHALL NOT claim bottom-pin
attribution.

Attribution SHALL NOT outlive the session it was recorded in: on a session
change it SHALL be discarded, so a snapshot cannot be matched against a different
transcript's scroll extent.

The position match SHALL tolerate sub-pixel differences in reported scroll
position, which occur under browser zoom and device-pixel rounding; it SHALL NOT
require exact equality.

#### Scenario: Programmatic scroll-to-bottom races a replay batch
- **GIVEN** the user has switched to a session whose events are not cached on the server
- **AND** the chat view has called `scrollTo` to land at the current bottom
- **WHEN** another `event_replay` batch arrives and grows `scrollHeight` before the previous `scrollTo` has produced its `onScroll` event
- **THEN** `isNearBottom` SHALL remain true
- **AND** the floating scroll-to-bottom button SHALL NOT appear
- **AND** the next render SHALL scroll to the new bottom

#### Scenario: Measurement clamp far below the new bottom keeps the follow
- **GIVEN** the chat view wrote a bottom-pin that was clamped to the then-current scroll extent
- **WHEN** off-screen rows measure in and grow the scroll extent by thousands of pixels before the induced scroll event is dispatched
- **AND** no user gesture has occurred
- **THEN** the follow state SHALL be preserved even though the reported position is far from the new bottom
- **AND** the view SHALL continue chasing the bottom on the next pin

#### Scenario: Attribution does not cross a session switch
- **GIVEN** the chat view recorded a bottom-pin snapshot in one session
- **WHEN** the user switches to a different session and its first scroll event is dispatched
- **THEN** that event SHALL NOT be matched against the previous session's snapshot

#### Scenario: Scrollbar drag away from the pin releases the follow
- **GIVEN** the chat view wrote a bottom-pin and recorded the position it achieved
- **WHEN** the user drags the scrollbar upward, producing a scroll event at a different position with no wheel or touch input
- **THEN** the event SHALL NOT be treated as a measurement clamp
- **AND** the follow state SHALL be released
- **AND** the recorded pin SHALL NOT be able to preserve the follow on any later event

#### Scenario: Real user scroll during replay still wins
- **GIVEN** event replay is in progress
- **WHEN** the user actively scrolls upward (e.g. wheel, touch, drag the scrollbar)
- **THEN** within at most 150 ms of the user's scroll, `isNearBottom` SHALL be set to false
- **AND** the floating scroll-to-bottom button SHALL appear
- **AND** subsequent replay batches SHALL NOT pull the view back to the bottom

#### Scenario: Position inconsistent with the pin still releases the follow
- **GIVEN** the chat view wrote a bottom-pin and recorded the position it achieved
- **WHEN** a scroll event reports a position above that recorded position
- **THEN** it SHALL NOT be treated as a measurement clamp
- **AND** the normal position rules SHALL apply, releasing the follow if the position is away from the bottom

#### Scenario: Final position is the latest message after replay
- **GIVEN** the user switched to an uncached session and did not scroll
- **WHEN** all `event_replay` batches have been processed
- **THEN** the chat view SHALL be scrolled to the latest message
- **AND** the floating scroll-to-bottom button SHALL NOT be visible

#### Scenario: Long session opens at the latest message
- **GIVEN** a session with a transcript long enough that rows measure in progressively after the initial pin
- **WHEN** the user opens that session and performs no scroll gesture
- **THEN** the view SHALL come to rest at the latest message, not part-way up the transcript
- **AND** the floating scroll-to-bottom button SHALL NOT be visible

#### Scenario: Auto-scroll suspended while selecting, resumed on collapse
- **GIVEN** the user was at the bottom following a live stream
- **WHEN** the user holds an active transcript selection while new content streams in
- **THEN** the view SHALL NOT auto-scroll to the bottom for the lifetime of the selection
- **AND** when the selection collapses the view SHALL resume following the bottom
