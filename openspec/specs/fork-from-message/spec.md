## ADDED Requirements

### Requirement: Events carry entry IDs

The `state-replay.ts` module SHALL attach the session entry's `id` as `entryId` in the `data` payload of `message_start` and `message_end` events. The extension's live event forwarding SHALL also include `entryId` via `ctx.sessionManager.getLeafId()`.

#### Scenario: Replayed user message includes entryId
- **WHEN** `replayEntriesAsEvents` processes a user message entry with `id: "abc-123"`
- **THEN** the generated `message_start` event's `data` SHALL contain `entryId: "abc-123"`

#### Scenario: Replayed assistant message includes entryId
- **WHEN** `replayEntriesAsEvents` processes an assistant message entry with `id: "def-456"`
- **THEN** the generated `message_end` event's `data` SHALL contain `entryId: "def-456"`

#### Scenario: Live event enriched with entryId
- **WHEN** the bridge forwards a live `message_start` or `message_end` event and `ctx.sessionManager.getLeafId()` returns `"live-789"`
- **THEN** the forwarded event's `data` SHALL contain `entryId: "live-789"`

### Requirement: ChatMessage stores entryId

The `ChatMessage` interface SHALL include an optional `entryId?: string` field. The event reducer SHALL populate it from the event's `data.entryId` when processing `message_start` (user) and `message_end` (assistant) events.

#### Scenario: User message ChatMessage has entryId
- **WHEN** the event reducer processes a `message_start` event with `data.entryId: "abc-123"`
- **THEN** the resulting ChatMessage SHALL have `entryId: "abc-123"`

#### Scenario: Assistant message ChatMessage has entryId
- **WHEN** the event reducer processes a `message_end` event with `data.entryId: "def-456"`
- **THEN** the resulting ChatMessage SHALL have `entryId: "def-456"`

#### Scenario: Missing entryId is undefined
- **WHEN** the event reducer processes a `message_start` event without `data.entryId`
- **THEN** the resulting ChatMessage SHALL have `entryId: undefined`

### Requirement: Resume session protocol supports entryId

The `ResumeSessionBrowserMessage` SHALL include an optional `entryId?: string` field. When present with `mode: "fork"`, the server SHALL fork from that specific entry rather than the session's latest entry.

#### Scenario: Fork with entryId
- **WHEN** the server receives `resume_session` with `mode: "fork"` and `entryId: "abc-123"`
- **THEN** the server SHALL create a branched session file containing only root→"abc-123" entries and fork from that file

#### Scenario: Fork without entryId (backward compatible)
- **WHEN** the server receives `resume_session` with `mode: "fork"` and no `entryId`
- **THEN** the server SHALL fork from the full session file (existing behavior)

### Requirement: Server creates branched session for entry-specific fork

When `handleResumeSession` receives a fork request with `entryId`, it SHALL use `createBranchedSessionFile(sessionFile, entryId)` to produce a pruned JSONL session file containing only entries from root through and INCLUDING the target entry, then spawn `pi --fork` on the pruned file. The forked session's chat history MUST contain the clicked message as its tail entry (not as N-1).

#### Scenario: Successful entry-specific fork includes the clicked entry
- **WHEN** the server processes a fork with `entryId: "abc-123"` and the entry exists in the session file
- **THEN** a new JSONL session file is created with all entries from root through `"abc-123"`, with `"abc-123"` itself as the last non-header entry
- **AND** `pi --fork` is spawned with the new file path
- **AND** the resulting forked session's chat history contains the message represented by `"abc-123"` as its tail

#### Scenario: Fork from a user-message bubble includes that user message
- **WHEN** the user clicks the per-message ⑂ Fork button on a user-message bubble whose ChatMessage has `entryId: "user-N"`
- **THEN** the server SHALL fork to a new session whose tail entry is `"user-N"` (the user message itself)
- **AND** the forked session's chat history SHALL contain that user message

#### Scenario: Fork from an assistant-message bubble includes that assistant message
- **WHEN** the user clicks the per-message ⑂ Fork button on an assistant-message bubble whose ChatMessage has `entryId: "asst-M"`
- **THEN** the server SHALL fork to a new session whose tail entry is `"asst-M"` (the assistant message itself)
- **AND** the forked session's chat history SHALL contain that assistant message

#### Scenario: Invalid entryId
- **WHEN** the server processes a fork with an `entryId` that does not exist in the session file
- **THEN** the server SHALL return `resume_result` with `success: false` and an error message

### Requirement: Fork button in message toolbar

ChatView SHALL display a fork button in the `MessageBubble` toolbar on user and assistant messages, alongside the existing copy buttons. The button SHALL be hidden when `entryId` is undefined.

#### Scenario: Fork button visible in toolbar
- **WHEN** a user or assistant message has an `entryId`
- **THEN** a fork button SHALL be visible in the message toolbar

#### Scenario: Fork button hidden without entryId
- **WHEN** a user or assistant message has no `entryId`
- **THEN** no fork button SHALL be shown in the toolbar

#### Scenario: Fork button triggers fork
- **WHEN** the user clicks the fork button on a message with `entryId: "abc-123"` in session "sess-1"
- **THEN** the client SHALL send `resume_session` with `sessionId: "sess-1"`, `mode: "fork"`, `entryId: "abc-123"`

### Requirement: Forked session has clean OpenSpec state

OpenSpec activity detection SHALL be skipped during event replay. On `replay_complete`, `openspecPhase` and `openspecChange` SHALL be explicitly cleared. This prevents stale OpenSpec state from the parent session leaking into forked sessions.

#### Scenario: OpenSpec detection skipped during replay
- **WHEN** replayed events contain `tool_execution_start` events that match OpenSpec activity patterns
- **THEN** the server SHALL NOT update `openspecPhase` or `openspecChange` from those events

#### Scenario: OpenSpec state cleared after replay
- **WHEN** `replay_complete` is received for a session
- **THEN** `openspecPhase` and `openspecChange` SHALL be set to `null`

### Requirement: Fork donor uses actual parent session

When inheriting `attachedProposal` for a forked session, the server SHALL use the specific parent session recorded by `pendingForkRegistry`, not search for any ended session in the same cwd.

#### Scenario: Correct proposal inherited from parent
- **WHEN** session B is forked from session A which has `attachedProposal: "my-change"`
- **THEN** session B SHALL inherit `attachedProposal: "my-change"` from session A specifically

#### Scenario: Unrelated ended sessions ignored
- **WHEN** session B is forked from session A (no proposal) and session C (ended, different session) has `attachedProposal: "other-change"`
- **THEN** session B SHALL NOT inherit `attachedProposal` from session C

### Requirement: Forked sessions appear at top of list

Forked sessions SHALL be inserted at the top of the session list for their cwd, consistent with how new sessions behave.

#### Scenario: Fork appears at top
- **WHEN** a session is forked
- **THEN** the new session card SHALL appear at the top of its folder's session list
