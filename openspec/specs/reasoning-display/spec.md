## Purpose

Displays model reasoning/thinking content in the chat view as collapsible blocks, with live streaming support during generation.
## Requirements
### Requirement: Streaming thinking accumulation
The event reducer SHALL accumulate thinking content from `assistantMessageEvent` with `type: "thinking_delta"` into a `streamingThinking` field on `SessionState`. On `thinking_start`, the field SHALL be initialized to empty string. On each `thinking_delta`, the delta text SHALL be appended.

#### Scenario: Thinking delta arrives
- **WHEN** a `message_update` event contains `assistantMessageEvent.type === "thinking_delta"` with `delta` text
- **THEN** `state.streamingThinking` SHALL have the delta appended to its current value

#### Scenario: Thinking start resets accumulator
- **WHEN** a `message_update` event contains `assistantMessageEvent.type === "thinking_start"`
- **THEN** `state.streamingThinking` SHALL be set to empty string

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

### Requirement: Full thinking text storage
The reducer SHALL store the complete thinking text without truncation in the thinking message's `content` field.

#### Scenario: Long reasoning preserved
- **WHEN** a thinking block contains 10,000+ characters
- **THEN** the full text SHALL be stored in the message content

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

### Requirement: Inline-flow rendering mode for reasoning bodies
The system SHALL support an inline-flow rendering mode for reasoning blocks, controlled by the `reasoningInlineFlow` display preference (default `false`). When enabled, an expanded reasoning block's body SHALL render with no height cap and no inner vertical scrollbar, flowing down the chat transcript like any other row. When disabled, the body SHALL render with today's bounded height and inner scroll. The preference SHALL govern the body's HEIGHT ONLY and SHALL be orthogonal to all open/closed collapse behavior: the auto-collapse timer, the turn-scoped hold, manual toggling, and the live/replayed mount defaults SHALL behave identically in both modes.

#### Scenario: Default keeps the bounded scrollbox
- **WHEN** `reasoningInlineFlow` is `false` (including all preset defaults and legacy preferences without the field)
- **THEN** an expanded reasoning body SHALL render with the existing bounded height and inner vertical scrollbar

#### Scenario: Inline flow removes the height cap
- **WHEN** `reasoningInlineFlow` is `true` and a reasoning block is expanded
- **THEN** the body SHALL render at its natural height with no vertical height cap and no inner vertical scrollbar
- **AND** the body SHALL remain clipped horizontally only (long lines scroll horizontally, not wrap-forced)

#### Scenario: Orthogonal to collapse behavior
- **WHEN** `reasoningInlineFlow` is `true`
- **THEN** live blocks SHALL still mount expanded and auto-collapse per `reasoningAutoCollapseMs` unless `keepReasoningOpenUntilTurnEnds` holds them
- **AND** replayed blocks SHALL still mount collapsed
- **AND** manual toggling SHALL still pin the block's open/closed state

#### Scenario: Applies to every first-party reasoning mount site
- **WHEN** a reasoning block renders in a first-party surface — in the ChatView message list, as the live streaming-thinking tail, or as an absorbed thinking block inside a tool-call group
- **THEN** the same `reasoningInlineFlow` preference SHALL govern its body height
- **AND** plugin-rendered thinking blocks (the `ThinkingBlockPrimitive` ui-primitive registration, which has no prefs access) SHALL keep today's bounded body — out of scope for this change

