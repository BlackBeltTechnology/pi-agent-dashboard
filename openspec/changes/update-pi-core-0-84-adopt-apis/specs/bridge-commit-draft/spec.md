## MODIFIED Requirements

### Requirement: Ephemeral in-process fork-subagent

The system SHALL run exactly one agent turn on an ephemeral in-memory session created on the live session's model with no tools, SHALL capture only the assistant text from the event stream, and SHALL always dispose the subagent. The visible conversation SHALL never be appended to. The session SHALL be constructed through whichever harness session API the running pi exposes: pi 0.84.0 replaced the pi-agent-core harness session model with the v4 lane-based `Session` / `SessionStorage` / `SessionRepo` APIs, so the runner SHALL feature-detect the available constructor and SHALL retain a working path on pi at or above `piCompatibility.minimum`.

#### Scenario: Draft captured off the event stream

- WHEN a subagent draft runs
- THEN a throwaway in-memory agent session is created on the live session's model with an empty tool set and the resolved cwd
- AND the runner subscribes to the session and accumulates only `message_update` events whose `assistantMessageEvent` is a `text_delta`
- AND after the single `prompt` completes the captured text is trimmed and returned
- AND the subscription is unsubscribed and the session disposed in every outcome

#### Scenario: v4 lane-based session API available

- WHEN the running pi exposes the v4 lane-based `Session` / `SessionStorage` / `SessionRepo` construction path
- THEN the runner SHALL create the ephemeral session through that path
- AND the captured-text and disposal behavior SHALL be unchanged

#### Scenario: Pre-v4 harness session API on floor pi

- WHEN the running pi exposes only the pre-0.84 `SessionManager.inMemory` harness path
- THEN the runner SHALL create the ephemeral session through that path
- AND the draft SHALL be produced with no crash and no behavior regression

#### Scenario: No model available

- WHEN the live session exposes no model
- THEN the runner throws before creating a subagent, triggering a lower ladder rung

#### Scenario: Empty assistant output

- WHEN the captured assistant text is empty after trimming
- THEN the runner throws `empty-draft`, triggering a lower ladder rung

#### Scenario: Hung turn abandoned

- WHEN the agent turn does not complete within the timeout (default 30000 ms)
- THEN the turn is abandoned via a timeout rejection and the subagent is disposed
