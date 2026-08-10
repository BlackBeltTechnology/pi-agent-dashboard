## MODIFIED Requirements

### Requirement: Ephemeral in-process fork-subagent

The system SHALL run exactly one agent turn on an ephemeral in-memory session created on the live session's model with no tools, SHALL capture only the assistant text from the event stream, and SHALL always dispose the subagent. The visible conversation SHALL never be appended to.

The session SHALL be constructed through the `pi-coding-agent` SDK surface: `createAgentSession({ sessionManager: SessionManager.inMemory(cwd), model, tools: [], cwd })`. pi 0.84.0 replaced the **pi-agent-core** harness session model with the v4 lane-based `Session` / `SessionStorage` / `SessionRepo` APIs, but that break does NOT reach this SDK surface — `createAgentSession`, `SessionManager`, and `SessionManager.inMemory` remain exported and callable. The runner SHALL therefore NOT carry a feature-detection branch for a migration that has not occurred, and the SDK surface's continued presence SHALL be asserted so its removal fails loudly rather than at runtime.

#### Scenario: Draft captured off the event stream

- WHEN a subagent draft runs
- THEN a throwaway in-memory agent session is created on the live session's model with an empty tool set and the resolved cwd
- AND the runner subscribes to the session and accumulates only `message_update` events whose `assistantMessageEvent` is a `text_delta`
- AND after the single `prompt` completes the captured text is trimmed and returned
- AND the subscription is unsubscribed and the session disposed in every outcome

#### Scenario: SDK session surface remains available

- WHEN the pinned pi's SDK entrypoint is loaded
- THEN `createAgentSession`, `SessionManager`, and `SessionManager.inMemory` SHALL all be callable
- AND a pi release that collapses them into the v4 lane API SHALL fail this assertion, forcing the not-applicable finding to be revisited

#### Scenario: The v4 pi-agent-core break is recorded as not applicable

- WHEN the 0.84.x v4 lane-based session model is compared against this runner
- THEN the runner SHALL construct its session through the unchanged SDK surface
- AND the runner SHALL NOT carry a constructor-shape feature-detection branch

#### Scenario: No model available

- WHEN the live session exposes no model
- THEN the runner throws before creating a subagent, triggering a lower ladder rung

#### Scenario: Empty assistant output

- WHEN the captured assistant text is empty after trimming
- THEN the runner throws `empty-draft`, triggering a lower ladder rung

#### Scenario: Hung turn abandoned

- WHEN the agent turn does not complete within the timeout (default 30000 ms)
- THEN the turn is abandoned via a timeout rejection and the subagent is disposed
