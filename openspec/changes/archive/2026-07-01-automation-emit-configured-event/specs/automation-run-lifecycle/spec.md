## ADDED Requirements

### Requirement: Dispatch delivery by action kind

When a run session registers, the engine SHALL deliver the run's action dispatch resolved at start: for a prompt action it SHALL seed the prompt text via `sendToSession`; for an event action it SHALL emit the configured event via `emitEventToSession`. Delivery SHALL happen exactly once per run and only after the session is correlated to the run by its `runId` stamp. Run finalization SHALL remain on `agent_end` for both kinds.

#### Scenario: Event action delivery

- **WHEN** a run for an event action's automation registers its session
- **THEN** the engine SHALL emit the action's configured event into that session and SHALL NOT send a text prompt.

#### Scenario: Prompt action delivery unchanged

- **WHEN** a run for a prompt action registers its session
- **THEN** the engine SHALL seed the prompt text via `sendToSession` and finalize on `agent_end` as before.
