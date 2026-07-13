## Purpose

Defines auto-scroll and scroll-lock behavior for the chat message view: pause auto-scroll when the user scrolls away from the bottom, expose a scroll-to-bottom affordance when locked, and keep auto-scroll robust against multi-batch event replay.
## Requirements
### Requirement: Scroll lock when user scrolls up
The chat view SHALL pause auto-scrolling when the user scrolls away from the bottom of the message list. Auto-scroll SHALL resume only when the user scrolls back to within 50px of the bottom.

#### Scenario: User scrolls up during streaming
- **WHEN** the user scrolls up so that the scroll position is more than 50px from the bottom
- **THEN** new messages and streaming content SHALL NOT cause the view to scroll

#### Scenario: User scrolls back to bottom
- **WHEN** the user scrolls to within 50px of the bottom
- **THEN** auto-scroll SHALL resume and the view SHALL follow new content

### Requirement: Scroll-to-bottom button
The chat view SHALL display a floating button when the user is scroll-locked (not near the bottom). The button SHALL be centered horizontally at the bottom of the chat area.

#### Scenario: Button appears when scrolled up
- **WHEN** the scroll position is more than 50px from the bottom
- **THEN** a scroll-to-bottom button SHALL be visible

#### Scenario: Button hidden when at bottom
- **WHEN** the scroll position is within 50px of the bottom
- **THEN** the scroll-to-bottom button SHALL NOT be visible

#### Scenario: Clicking button scrolls to bottom and resumes follow
- **WHEN** the user clicks the scroll-to-bottom button
- **THEN** the view SHALL smooth-scroll to the bottom AND auto-scroll SHALL resume

### Requirement: Auto-scroll robust to multi-batch event replay
When the chat view scrolls programmatically (on session switch in the "near bottom" branch, or when new content arrives while the user is at the bottom), the resulting `onScroll` event SHALL NOT cause the view to register that the user has scrolled away from the bottom. The auto-scroll chase SHALL continue across every subsequent `event_replay` batch until either replay completes or the user performs a real scroll gesture. The auto-scroll bottom-pin (both the `stickToBottom` follow effect and the virtualizer `onChange` re-pin) SHALL additionally be suspended while an active transcript selection is held, and SHALL resume on selection collapse without clearing the underlying at-bottom follow state.

#### Scenario: Programmatic scroll-to-bottom races a replay batch
- **GIVEN** the user has switched to a session whose events are not cached on the server
- **AND** the chat view has called `scrollTo` to land at the current bottom
- **WHEN** another `event_replay` batch arrives and grows `scrollHeight` before the previous `scrollTo` has produced its `onScroll` event
- **THEN** `isNearBottom` SHALL remain true
- **AND** the floating scroll-to-bottom button SHALL NOT appear
- **AND** the next render SHALL scroll to the new bottom

#### Scenario: Real user scroll during replay still wins
- **GIVEN** event replay is in progress
- **WHEN** the user actively scrolls upward (e.g. wheel, touch, drag the scrollbar)
- **THEN** within at most 150 ms of the user's scroll, `isNearBottom` SHALL be set to false
- **AND** the floating scroll-to-bottom button SHALL appear
- **AND** subsequent replay batches SHALL NOT pull the view back to the bottom

#### Scenario: Final position is the latest message after replay
- **GIVEN** the user switched to an uncached session and did not scroll
- **WHEN** all `event_replay` batches have been processed
- **THEN** the chat view SHALL be scrolled to the latest message
- **AND** the floating scroll-to-bottom button SHALL NOT be visible

#### Scenario: Auto-scroll suspended while selecting, resumed on collapse
- **GIVEN** the user was at the bottom following a live stream
- **WHEN** the user holds an active transcript selection while new content streams in
- **THEN** the view SHALL NOT auto-scroll to the bottom for the lifetime of the selection
- **AND** when the selection collapses the view SHALL resume following the bottom

