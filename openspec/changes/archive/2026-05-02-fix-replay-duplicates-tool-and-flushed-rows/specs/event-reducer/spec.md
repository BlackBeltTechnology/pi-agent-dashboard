## MODIFIED Requirements

### Requirement: Full replay state reset
When an `event_replay` message is received, the reducer SHALL reset session state to `createInitialState()` before applying the replayed events whenever the batch represents a re-replay of already-seen events. Concretely, the reset SHALL fire when **either**:

- the first event's `seq === 1`, OR
- the first event's `seq <= maxSeqMap.get(sessionId)` (i.e. the server is replaying events the client has already accounted for, regardless of whether the batch starts at `seq=1` or somewhere later in the stream).

This broader trigger handles paginated / lazy / multi-batch replay where a reconnect-driven re-replay's first batch may not start at `seq=1` (for example when the server splits replay into chunks and the second chunk's first event is `seq=K, K>1`, the existing state contains events 1..N where N≥K, so the replay is overlapping and SHALL reset).

When the reset fires, the receiver state SHALL be `createInitialState()`. Otherwise the existing state SHALL be preserved and the new events SHALL be reduced on top of it. An empty events array SHALL preserve state regardless of `maxSeqMap`.

#### Scenario: Full replay starting at seq=1 resets state
- **WHEN** an `event_replay` arrives with events starting at `seq: 1`
- **THEN** the session state SHALL be reset to `createInitialState()` before reducing the replayed events

#### Scenario: Reconnect re-replay starting mid-stream resets state
- **WHEN** the client has previously processed events through `seq: 100` (so `maxSeqMap.get(sid) === 100`)
- **AND** an `event_replay` arrives with events starting at `seq: 51`
- **THEN** the session state SHALL be reset to `createInitialState()` before reducing the replayed events (the second replay overlaps with seen state)

#### Scenario: Genuine incremental tail extension preserves state
- **WHEN** the client has previously processed events through `seq: 100`
- **AND** an `event_replay` arrives with events starting at `seq: 101`
- **THEN** the existing session state SHALL be preserved and the new events SHALL be reduced on top of it

#### Scenario: Empty replay preserves state
- **WHEN** an `event_replay` arrives with an empty events array
- **THEN** the existing session state SHALL be preserved (no reset)

## ADDED Requirements

### Requirement: Tool execution start is idempotent on toolCallId
A `tool_execution_start` event SHALL NOT push a duplicate `toolResult` row when a row with the same `toolCallId` already exists in `messages[]` and is in the `running` state. Instead, the existing row SHALL be updated in place — `args`, `toolName`, `startedAt`, and `timestamp` SHALL be refreshed to the new event's values; `result`, `images`, `duration`, and `toolDetails` (if any) SHALL be left untouched.

If the existing row's `toolStatus` is `complete` or `error` (already terminal), the event SHALL fall through to the existing push path so a genuine reuse of the toolCallId (extremely unlikely given UUIDv4 generation, but defensible) does not silently overwrite a finalized tool card.

This makes the reducer mathematically idempotent on `tool_execution_start` for in-flight tools: replaying the same event N times produces exactly one `toolResult` row, not N.

#### Scenario: First tool_execution_start pushes a row
- **WHEN** the reducer receives `tool_execution_start { toolCallId: "t1", toolName: "bash", args: { command: "ls" } }`
- **AND** no existing row in `messages[]` has `toolCallId === "t1"`
- **THEN** a new `toolResult` row with `id: "tool-t1"`, `toolCallId: "t1"`, `toolStatus: "running"`, `args: { command: "ls" }` SHALL be appended to `messages[]`

#### Scenario: Replayed tool_execution_start with running existing row updates in place
- **WHEN** an existing row with `id: "tool-t1"`, `toolStatus: "running"` is in `messages[]`
- **AND** a second `tool_execution_start { toolCallId: "t1", toolName: "bash", args: { command: "ls -la" } }` arrives
- **THEN** the existing row SHALL be updated in place: `args.command === "ls -la"`, `startedAt` and `timestamp` refreshed; `messages.length` SHALL be unchanged

#### Scenario: tool_execution_start on terminal existing row falls through to push
- **WHEN** an existing row with `id: "tool-t1"`, `toolStatus: "complete"` is in `messages[]`
- **AND** a second `tool_execution_start { toolCallId: "t1", ... }` arrives
- **THEN** a new row SHALL be appended (the original completed row is preserved)

#### Scenario: Idempotency under N-fold replay
- **WHEN** a sequence of `tool_execution_start` events with N distinct `toolCallId`s is reduced from `createInitialState()` once
- **AND** the same sequence is reduced again from `createInitialState()` (i.e. starting fresh)
- **THEN** the resulting `messages[]` SHALL be deeply equal to the result of reducing the sequence once
- **AND** when the sequence is replayed against the *result* of the first reduction (without resetting state), the row count SHALL still be N — the reducer SHALL NOT produce 2N rows

### Requirement: Flushed assistant row uses content-stable id
The `flushStreamingTextAsAssistantRow` helper SHALL produce an `id` that is stable across replays of the same event sequence. The id SHALL be derived from the upcoming tool's `toolCallId` (the tool whose `tool_execution_start` triggered the flush): specifically `flush-${toolCallId}`. The id SHALL NOT depend on `state.messages.length` or any other length-derived quantity.

The helper SHALL skip the push when a row with the matching `flush-${toolCallId}` id already exists in `messages[]`. This enforces idempotency: replaying the same `tool_execution_start` event multiple times produces exactly one flushed assistant row, not one per replay.

The function signature SHALL accept the `toolCallId` as an explicit third parameter; the single caller in the `tool_execution_start` reducer arm has it in scope.

The hard turn-boundary clamp on `findFlushedAssistantRowIndex` (introduced in change `fix-streaming-text-vs-interactive-ui-order`, R3 invariant) SHALL be preserved unchanged. The function continues to scan by `role === "assistant" && entryId === undefined && nonce === undefined`, which the new id pattern satisfies.

The `streamingTextFlushed` per-message lifecycle invariants from change `fix-streaming-text-vs-interactive-ui-order` (R1, R2, R5, R6, R7) SHALL be preserved unchanged: the flag is reset on assistant `message_start` AND on assistant `message_end`; `message_update` skips its `streamingText = text` write when the flag is true; `message_end` stamps `entryId/nonce` in place via `findFlushedAssistantRowIndex`.

#### Scenario: Flushed row id derives from toolCallId
- **WHEN** `flushStreamingTextAsAssistantRow(state, timestamp, "t1")` is called with non-empty `streamingText`
- **AND** `streamingTextFlushed === false`
- **THEN** a new assistant row SHALL be appended with `id === "flush-t1"`

#### Scenario: Repeated flush call with same toolCallId is idempotent
- **WHEN** the helper is called with `toolCallId: "t1"` and pushes a `flush-t1` row
- **AND** the helper is called again with the same `toolCallId: "t1"` (e.g. via replayed `tool_execution_start`)
- **THEN** no second row SHALL be appended; `messages.filter(m => m.id === "flush-t1").length` SHALL equal 1

#### Scenario: Flush id stability across full replay
- **WHEN** an event sequence containing assistant streaming text followed by `tool_execution_start { toolCallId: "t1" }` is reduced from `createInitialState()` once
- **AND** the sequence is reduced again from `createInitialState()`
- **THEN** the resulting `messages[]` SHALL be deeply equal to the first run's result; the flush row's id SHALL be `"flush-t1"` in both runs (not `"msg-3"` and `"msg-7"` respectively)

#### Scenario: Stamp at message_end finds the stable-id row
- **WHEN** a `flush-t1` row exists in `messages[]` with `entryId === undefined` and `nonce === undefined`
- **AND** an assistant `message_end { data: { entryId: "e1", nonce: "n1" } }` arrives
- **THEN** `findFlushedAssistantRowIndex` SHALL locate the row by `entryId/nonce` absence (NOT by id pattern matching)
- **AND** the row SHALL be stamped in place with `entryId: "e1"`, `nonce: "n1"`; the id `"flush-t1"` SHALL be preserved
