## MODIFIED Requirements

### Requirement: Thinking block completion creates message
When a `thinking_end` event arrives, the reducer SHALL create a `ChatMessage` with `role: "thinking"` containing the accumulated thinking text, reset `streamingThinking` to empty string, and record whether the block was streamed live in the current view.

The reducer SHALL accept a provenance signal indicating whether the event is being reduced from the live event path (`case "event"`) or the batch replay path (`case "event_replay"`). When live, the created thinking message SHALL have `streamedLive: true`. When replay (or when the signal is absent), the message SHALL have `streamedLive` falsy. Re-replay of an already-seen thinking block SHALL keep `streamedLive` falsy.

#### Scenario: Thinking end flushes to message
- **WHEN** a `message_update` event contains `assistantMessageEvent.type === "thinking_end"`
- **THEN** a new message with `role: "thinking"` and content equal to the accumulated `streamingThinking` SHALL be appended to `state.messages`
- **AND** `state.streamingThinking` SHALL be reset to empty string

#### Scenario: Empty thinking block produces no message
- **WHEN** `thinking_end` arrives but `streamingThinking` is empty
- **THEN** no thinking message SHALL be created

#### Scenario: Live-streamed thinking is flagged
- **WHEN** `thinking_end` is reduced from the live event path
- **THEN** the created thinking message SHALL have `streamedLive: true`

#### Scenario: Replayed thinking is not flagged
- **WHEN** `thinking_end` is reduced from the batch replay path (cold load, reconnect, or history)
- **THEN** the created thinking message SHALL have `streamedLive` falsy
- **AND** re-replaying the same events SHALL keep `streamedLive` falsy

### Requirement: Thinking blocks render as collapsible chat items
The ChatView SHALL render messages with `role: "thinking"` as collapsible blocks with a brain icon and "Reasoning" label. A replayed thinking block SHALL render collapsed by default. A live-streamed thinking block SHALL render expanded when it completes, then auto-collapse after a configurable delay.

#### Scenario: Replayed thinking message displayed collapsed
- **WHEN** a thinking message with `streamedLive` falsy exists in the messages array
- **THEN** it SHALL render as a collapsed block with a brain icon and "Reasoning" label
- **AND** it SHALL NOT arm an auto-collapse timer
- **AND** clicking it SHALL expand to show the full reasoning text

#### Scenario: Live-streamed thinking holds open then collapses
- **WHEN** a thinking message with `streamedLive: true` renders and `reasoningAutoCollapseMs > 0`
- **THEN** it SHALL render expanded on completion
- **AND** after `reasoningAutoCollapseMs` elapses it SHALL collapse
- **AND** the reasoning SHALL remain continuously visible across the streaming-to-completed swap (no collapse flicker)

#### Scenario: Auto-collapse disabled keeps live block open
- **WHEN** a live-streamed thinking block renders and `reasoningAutoCollapseMs === 0`
- **THEN** the block SHALL render expanded (the disabled timer SHALL NOT force it collapsed)
- **AND** it SHALL NOT arm a timer
- **AND** it SHALL remain expanded until the user collapses it

#### Scenario: Reconnect demotes a live block to history
- **WHEN** a live-streamed thinking block is displayed (expanded, timer pending) and a reconnect full-replay recreates the same message via the replay path so its `streamedLive` becomes false on the already-mounted block
- **THEN** the block SHALL collapse and its pending timer SHALL be cleared
- **AND** the block SHALL NOT remain stuck open
- **AND** if the user had manually toggled the block, that user-chosen state SHALL be preserved instead of being force-collapsed

#### Scenario: Manual toggle cancels the timer
- **WHEN** the user clicks a live-streamed thinking block before its auto-collapse timer expires
- **THEN** the timer SHALL be cancelled permanently for that block
- **AND** the block SHALL stay in the user-chosen state regardless of the remaining delay

#### Scenario: Collapse during streaming is preserved on completion
- **WHEN** the user manually collapses a reasoning block while it is still streaming
- **THEN** on `thinking_end` the committed thinking message SHALL render collapsed
- **AND** it SHALL NOT arm an auto-collapse timer
- **AND** a block the user did NOT collapse during streaming SHALL still hold open and auto-collapse per `reasoningAutoCollapseMs`

#### Scenario: Each live block times independently
- **WHEN** a turn contains multiple live-streamed thinking blocks
- **THEN** each block SHALL arm its own auto-collapse timer from its own completion
- **AND** blocks SHALL collapse independently on their own staggered schedules

#### Scenario: Streaming thinking displayed
- **WHEN** `state.streamingThinking` is non-empty
- **THEN** a live reasoning block SHALL be displayed showing the streaming text with a visual streaming indicator

### Requirement: ChatMessage type supports thinking role
The `ChatMessage` interface SHALL include `"thinking"` as a valid `role` value and SHALL include an optional `streamedLive` boolean recording whether the block was streamed live in the current view.

#### Scenario: Type definition
- **WHEN** a ChatMessage is created with `role: "thinking"`
- **THEN** it SHALL be valid according to the TypeScript type definition
- **AND** an optional `streamedLive` boolean SHALL be assignable
