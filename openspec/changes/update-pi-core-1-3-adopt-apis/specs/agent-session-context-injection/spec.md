## ADDED Requirements

### Requirement: A manual Retry turn receives the per-turn system-prompt contributions

With pi ≥ 1.2.0, the turn started by the bridge's Retry dispatch (`pi.sendMessage({ customType: "pi-dashboard:retry", display: false }, { triggerTurn: true })`) SHALL run every `before_agent_start` handler, with `event.messageType === "custom"`. The dashboard handlers SHALL NOT skip such runs: the dashboard session-context injector SHALL splice its fragment into the Retry turn's system prompt exactly as for a user-prompted turn. The handlers SHALL NOT read `event.prompt`, which is absent on custom-message runs.

#### Scenario: Retry turn carries the dashboard session-context fragment
- **GIVEN** a bridged session with an attached OpenSpec change
- **WHEN** `before_agent_start` fires with `messageType: "custom"` and no `prompt` for a `pi-dashboard:retry` turn
- **THEN** the injector SHALL return a `systemPrompt` containing the session-context fragment with the sessionId and the attached change

#### Scenario: Custom-message event without prompt does not throw
- **WHEN** a `before_agent_start` event with `messageType: "custom"`, a `message` and no `prompt` or `images` reaches the bridge
- **THEN** every bridge `before_agent_start` handler SHALL complete without throwing
- **AND** the pass-through forwarder SHALL forward the event

#### Scenario: Team guard filters skills on a Retry turn too
- **GIVEN** a team session whose policy grants one skill
- **WHEN** `before_agent_start` fires with `messageType: "custom"` for a Retry turn
- **THEN** the team-guard handler SHALL build a fresh grant filter for that start and leave only the granted skill in `systemPromptOptions.skills`
