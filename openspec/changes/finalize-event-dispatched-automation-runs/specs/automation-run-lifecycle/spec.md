## ADDED Requirements

### Requirement: Event-dispatched runs finalize on flow completion

An event-dispatched run (an action that emits a configured event into the
spawned session instead of seeding a prompt, e.g. `flows.run` → `flow:run`)
produces no agent turn in the host session and therefore emits no `agent_end`.
Such a run SHALL be finalized when the forwarded `flow_complete` event is
observed for its tracked session: the engine SHALL capture the run result and
call `onSessionEnded` (which terminates the now-idle spawned session and frees
the concurrency slot), exactly once. A prompt-dispatched run (one that seeded
prompt text) SHALL NOT finalize on `flow_complete`; it continues to finalize on
`agent_end`. Finalization SHALL remain idempotent: a later `agent_end` after a
`flow_complete` finalize is a no-op.

The captured result for an event-dispatched run SHALL be derived from the
`flow_complete` payload (the flow's status, name, and summary), since there is
no assistant turn to capture.

#### Scenario: Event-dispatched flow run finalizes on flow_complete

- **WHEN** a tracked run session that was NOT seeded a prompt observes a
  `flow_complete` event
- **THEN** the run is finalized once, its result is the flow's outcome summary,
  and its spawned session is terminated so the next scheduled fire can start.

#### Scenario: Prompt-dispatched run ignores flow_complete

- **WHEN** a tracked run session that WAS seeded a prompt observes a
  `flow_complete` event
- **THEN** the run is not finalized by it and still finalizes on `agent_end`.

#### Scenario: agent_end after flow_complete is a no-op

- **WHEN** an event-dispatched run already finalized on `flow_complete` later
  observes an `agent_end`
- **THEN** no second finalization occurs.
