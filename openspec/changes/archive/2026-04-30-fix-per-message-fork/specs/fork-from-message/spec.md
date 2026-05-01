## MODIFIED Requirements

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
