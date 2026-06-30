## MODIFIED Requirements

### Requirement: Assistant message streaming

A `message_update` event SHALL accumulate assistant text into `streamingText` and thinking content into `streamingThinking`. A `message_end` event SHALL finalize the message, moving streaming content into a permanent `ChatMessage` and clearing streaming state. When the `message_end` event payload carries `data.message.content` (pi 0.71+ allows extensions to replace the finalized message), the reducer SHALL prefer `msg.content` over the accumulated `streamingText` for the resulting row's `content` field. A pure helper `deriveEffectiveAssistantText(msg, fallback)` SHALL implement this preference: array content concatenates `type: "text"` parts; string content is used directly; missing content falls through to `fallback` (`streamingText`).

The preference SHALL apply uniformly across all three branches of the `message_end` arm:

- **Already-flushed row** (`streamingTextFlushed === true`): in addition to stamping `entryId` and `nonce` onto the existing flushed row, the row's `content` SHALL be updated to `effectiveContent` when `msg.content` is present and differs from the current value.
- **Streaming-row push** (`streamingText` non-empty, no flush): the pushed assistant `ChatMessage` SHALL use `effectiveContent` as its `content`.
- **Replay/fork** (`streamingText` empty AND no flushed row): existing behavior — read `msg.content` to construct the row — is unchanged.

#### Scenario: Streaming text accumulates
- **WHEN** successive `message_update` events arrive with text content
- **THEN** `streamingText` SHALL contain the full accumulated text

#### Scenario: Thinking content tracked separately
- **WHEN** a `message_update` contains a `thinking` content part
- **THEN** `streamingThinking` SHALL accumulate the thinking text

#### Scenario: Message finalized via deltas
- **WHEN** a `message_end` event arrives without `msg.content` (or with content matching the accumulated deltas)
- **THEN** a permanent assistant `ChatMessage` SHALL be added to `messages` with content equal to `streamingText` and streaming state SHALL be cleared

#### Scenario: Extension replaces message content at message_end
- **WHEN** a `message_end` event arrives with `data.message.content = [{ type: "text", text: "REPLACED" }]`
- **AND** the assistant text was previously flushed into a row by a `tool_execution_start`
- **THEN** the existing flushed row's `content` SHALL be updated to `"REPLACED"`, and `entryId` + `nonce` SHALL be stamped, with no duplicate row pushed

#### Scenario: Extension replaces message content during streaming push
- **WHEN** a `message_end` event arrives with `data.message.content = [{ type: "text", text: "xyz" }]`
- **AND** `streamingTextFlushed === false` and `streamingText === "abc"`
- **THEN** the pushed `ChatMessage` SHALL have `content: "xyz"` (from msg.content), NOT `"abc"` (from deltas)

## ADDED Requirements

### Requirement: Tool result truncation keeps last lines and marks omission

Tool execution result text rendered in the chat (live `tool_execution_update`, `tool_execution_end`, and replayed sessions) SHALL be truncated using `truncateOutputForDisplay(text, { maxLines })` rather than `truncateLines(text, 30)`. The new helper SHALL:

- Default `maxLines` to `200`.
- Keep the LAST `maxLines` lines (NOT the first).
- When truncation is applied, prepend a single marker line of the form `«N earlier lines hidden»` where `N` is the number of dropped lines.
- Return the original text unchanged when `lines.length <= maxLines`.

The same helper SHALL apply to all three call sites in `event-reducer.ts`: structured `tool_execution_update.partialResult`, plain-string `tool_execution_update.partialResult`, and `tool_execution_end.result`.

#### Scenario: Long bash stream keeps the tail
- **WHEN** `tool_execution_update` arrives with `partialResult` containing 500 lines
- **THEN** the rendered `result` SHALL contain a marker `«300 earlier lines hidden»` followed by lines 301–500

#### Scenario: Short output passes through
- **WHEN** `tool_execution_update.partialResult` contains 10 lines
- **THEN** the rendered `result` SHALL be exactly the original text — no marker, no truncation

#### Scenario: Final result truncated identically
- **WHEN** `tool_execution_end.result` is 1000 lines
- **THEN** the rendered `result` SHALL contain a marker `«800 earlier lines hidden»` followed by lines 201–1000
