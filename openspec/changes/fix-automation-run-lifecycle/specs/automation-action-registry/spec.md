## MODIFIED Requirements

### Requirement: Event-dispatch actions

A registered action MAY declare `buildEvent(args: { payload, automation }) => { eventType: string; data?: Record<string, unknown> } | null` as an alternative to `buildPrompt`. An action SHALL provide exactly one of `buildPrompt` or `buildEvent`. When an action declares `buildEvent`, the engine SHALL dispatch the run by emitting the returned event into the spawned run session via `emitEventToSession` (instead of seeding a prompt). A `null` return SHALL emit nothing. Prompt-based built-ins (`core.prompt`, `core.skill`) SHALL keep `buildPrompt` and dispatch unchanged.

The registry SHALL remain agnostic to which events exist — the registering plugin owns the `eventType` and `data` shape.

How a run of an event action FINISHES is NOT specified by this capability. Finalization is governed solely by `automation-run-lifecycle`: a run whose dispatch declared a completion event finalizes on that forwarded event, and every other run finalizes on `agent_end`. This capability SHALL NOT restate or contradict that rule.

#### Scenario: Event action emits its configured event

- **WHEN** an action registered with `buildEvent` returning `{ eventType: "flow:run", data: { flowName, task } }` fires
- **THEN** the engine SHALL emit `flow:run` with that data into the run session and SHALL NOT seed a text prompt.

#### Scenario: Prompt action is unaffected

- **WHEN** `core.prompt` fires
- **THEN** the engine SHALL seed its prompt text via `sendToSession` as before.

#### Scenario: Finalization is out of scope for this capability

- **WHEN** an event action's run needs to be finalized
- **THEN** the governing rule SHALL be the one in `automation-run-lifecycle`
- **AND** this capability SHALL assert nothing about `agent_end` versus a declared completion event.
