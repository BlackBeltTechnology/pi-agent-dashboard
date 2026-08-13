## ADDED Requirements

### Requirement: A healthy event-dispatched run SHALL finalize from the live completion event, not the reaper

For a run whose dispatched work completes normally, the terminal transition SHALL come from the forwarded completion event observed while the session is live. The max-age reaper SHALL remain a backstop for lost signals only: it SHALL NOT be the finalizing path for a run whose work completed successfully, and a completed run SHALL NOT be recorded with a max-age error.

Observability: the finalize path taken SHALL be distinguishable after the fact, so a systematic failure of the live path cannot masquerade as many independent timeouts.

#### Scenario: Successful flow run reaches done in seconds

- **GIVEN** an automation whose action dispatches an event and declares a completion event
- **WHEN** the dispatched work completes successfully
- **THEN** the run record SHALL reach a terminal `done` status within seconds of that completion
- **AND** the run SHALL NOT be left `running` until the max-age reaper sweeps it
- **AND** the record SHALL NOT carry a max-age error.

#### Scenario: Reaper firing on a completed run is a defect signal

- **GIVEN** a run whose dispatched work completed successfully
- **WHEN** that run is nonetheless finalized by the max-age reaper
- **THEN** that outcome SHALL be treated as a delivery defect in the event-forwarding path, not as a normal terminal state.

#### Scenario: Backstop still covers a genuinely lost signal

- **GIVEN** a run whose declared completion event never reaches the server while its session stays alive and its death is never observed (so neither the completion-event nor the session-death seam fires)
- **WHEN** the configured maximum age elapses
- **THEN** the reaper SHALL still finalize the run `error` and free the concurrency slot
- **AND** a run whose session DIES without a terminal event SHALL be finalized immediately by the session-death seam (see "Headless automation runs finalize on session death"), NOT left for the reaper.

## MODIFIED Requirements

### Requirement: Dispatch delivery by action kind

When a run session registers, the engine SHALL deliver the run's action dispatch resolved at start: for a prompt action it SHALL seed the prompt text via `sendToSession`; for an event action it SHALL emit the configured event via `emitEventToSession`. Delivery SHALL happen exactly once per run and only after the session is correlated to the run by its `runId` stamp. Finalization is NOT determined by the dispatch kind alone: a run finalizes on its declared completion event when its dispatch declared one, and on `agent_end` otherwise (see "Event-dispatched runs finalize on their declared completion event").

#### Scenario: Event action delivery

- **WHEN** a run for an event action's automation registers its session
- **THEN** the engine SHALL emit the action's configured event into that session and SHALL NOT send a text prompt.

#### Scenario: Prompt action delivery unchanged

- **WHEN** a run for a prompt action registers its session
- **THEN** the engine SHALL seed the prompt text via `sendToSession` and finalize on `agent_end` as before.

#### Scenario: Event action with a declared completion does not wait for agent_end

- **WHEN** a run for an event action whose dispatch declared a completion event is delivered
- **THEN** the run SHALL finalize on that declared completion event
- **AND** SHALL NOT require an `agent_end` that such a run never produces.
