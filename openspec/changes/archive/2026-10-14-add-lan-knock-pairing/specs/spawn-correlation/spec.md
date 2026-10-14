## MODIFIED Requirements

### Requirement: Client mints `requestId` on every browser-initiated spawn or resume
The client SHALL generate a UUIDv4 `requestId` (`crypto.randomUUID()` when available, otherwise an RFC 4122 version-4 UUID built from `crypto.getRandomValues`, so a non-secure browser context such as a plain-http LAN origin still mints one) whenever it dispatches a `spawn_session` or `resume_session` message. The `requestId` SHALL be sent as part of the message and tracked in a client-side `pendingSpawns: Map<requestId, { cwd, startedAt, attachProposal? }>` map (replacing today's `spawningCwds: Set<cwd>`).

#### Scenario: Spawn dispatch generates and tracks requestId
- **WHEN** the user clicks "New session" in a folder group
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the client SHALL add `(requestId, { cwd, startedAt: now() })` to `pendingSpawns`
- **AND** the dispatched `spawn_session` message SHALL contain the `requestId`

#### Scenario: Resume dispatch generates and tracks requestId
- **WHEN** the user clicks Resume or Fork on a session card
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the dispatched `resume_session` message SHALL contain the `requestId`

#### Scenario: Concurrent spawns produce distinct requestIds
- **WHEN** the user (or programmatic flow) issues two `spawn_session` calls in the same cwd within milliseconds
- **THEN** each call SHALL generate a distinct `requestId`
- **AND** `pendingSpawns` SHALL contain two entries simultaneously

#### Scenario: Non-secure context still mints a UUIDv4
- **WHEN** the client runs where `crypto.randomUUID` is undefined and dispatches `spawn_session`
- **THEN** the dispatched `requestId` SHALL be a valid version-4 UUID and no error SHALL be thrown
