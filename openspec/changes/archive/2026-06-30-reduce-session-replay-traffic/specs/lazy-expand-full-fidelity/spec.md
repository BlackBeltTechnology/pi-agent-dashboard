## ADDED Requirements

### Requirement: Heavy tool results replay as stubs with a preview

The server SHALL replay a finalized tool result that exceeds the configured stub
threshold as a stub carrying its true pre-truncation byte size, a short preview,
and a stable `entryId`, and SHALL NOT include the full body. The server SHALL
replay results at or below the threshold inline, and SHALL never stub an
in-flight or streaming result.

#### Scenario: Large tool result replays as a stub

- **WHEN** the server replays a finalized `tool_execution_end` whose original
  result exceeds the stub threshold
- **THEN** the replayed event SHALL include `{ stub: true, byteSize, preview, entryId }`
- **AND** SHALL NOT include the full result body

#### Scenario: Small tool result replays inline

- **WHEN** the server replays a finalized tool result at or below the threshold
- **THEN** the event SHALL be replayed inline with its body (unchanged behavior)

#### Scenario: Streaming tool result is never stubbed

- **WHEN** a tool result is still streaming (not finalized)
- **THEN** it SHALL be delivered inline via the live path, never as a stub

#### Scenario: Older clients ignore stub fields

- **WHEN** a client that predates this change receives a stubbed event
- **THEN** the additive stub fields SHALL be ignored
- **AND** the client SHALL render the inline preview text without error

### Requirement: Expanding a stub fetches the full untruncated body

A collapsed stub SHALL render its header and preview only. On expand, the client
SHALL fetch the full, untruncated tool body from a JSONL-backed route keyed on
`entryId` (not the runtime-local `seq`), and render it in place.

#### Scenario: Expand reveals full fidelity

- **WHEN** the user expands a stubbed tool result
- **THEN** the client SHALL fetch the full body by `entryId` from the
  full-fidelity route
- **AND** SHALL render the untruncated content (which MAY exceed the 4 KB
  in-memory truncation cap)

#### Scenario: Full-fidelity route reads JSONL, not the truncated store

- **WHEN** the full-fidelity route serves a tool body
- **THEN** it SHALL read from the persisted session JSONL
- **AND** SHALL NOT serve the 4 KB-truncated copy held in the in-memory store

#### Scenario: Offline expand degrades gracefully

- **WHEN** the user expands a stub while disconnected and the fetch fails
- **THEN** the client SHALL keep showing the preview
- **AND** SHALL surface a retry affordance rather than an empty card
