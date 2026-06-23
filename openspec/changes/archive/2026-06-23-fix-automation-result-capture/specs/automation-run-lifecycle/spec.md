## ADDED Requirements

### Requirement: Run result captures assistant output, not the injected prompt

A run's `result.md` SHALL contain the run session's assistant message output. The action prompt the engine injects into the run session (delivered via `sendToSession`) SHALL NOT appear in `result.md`. Only events carrying assistant message text SHALL be captured; a text-bearing event without an explicit `assistant` role SHALL NOT be treated as run output.

A run whose session produces no assistant output SHALL flush an empty result and SHALL be auto-archived (consistent with the existing "no findings" rule), regardless of the injected prompt having been delivered.

#### Scenario: Assistant reply captured, prompt excluded

- **WHEN** a run session is delivered the action prompt, the model replies with assistant text, and the session emits `agent_end`
- **THEN** `result.md` SHALL contain the assistant reply text AND SHALL NOT contain the injected action prompt

#### Scenario: No assistant output auto-archives

- **WHEN** a run session is delivered the action prompt but emits no assistant message text before `agent_end`
- **THEN** `result.md` SHALL be empty AND the run record SHALL be marked archived

#### Scenario: Role-less echo is not captured

- **WHEN** the run session emits a text-bearing event with no explicit `assistant` role (e.g. the injected-prompt echo)
- **THEN** that text SHALL NOT be appended to the run result
