## MODIFIED Requirements

### Requirement: The derived state survives the writers that clear currentTool

While a session has at least one pending prompt, a **live** event that would otherwise clear `currentTool` to `null` — `agent_start`, `agent_end`, or a `tool_execution_end` without `parentToolCallId` — SHALL leave the session's `currentTool` as `"ask_user"`. A nested `tool_execution_end` (carrying `parentToolCallId`) clears nothing, so it neither needs nor receives the reconciliation.

The reconciliation SHALL NOT be applied while the session is replaying. During replay `currentTool` SHALL remain purely event-derived, and the replay exit SHALL be the only place the registry is consulted for a replayed session. This keeps a stale registry entry from contaminating the stored value before the reconcile can prune it.

#### Scenario: Synthetic agent_start on bridge reconnect

- **WHEN** a session has a pending prompt
- **AND** a synthetic `agent_start` arrives (the bridge's mid-turn reconnect signal)
- **THEN** the session's `status` SHALL become `streaming`
- **AND** the session's `currentTool` SHALL remain `"ask_user"` rather than being cleared to `null`

#### Scenario: Agent ends while a prompt is still pending

- **WHEN** a session has a pending prompt and an `agent_end` arrives
- **THEN** the session's `status` SHALL become `idle`
- **AND** the session's `currentTool` SHALL remain `"ask_user"`

#### Scenario: Replayed events are not folded

- **WHEN** a session has a tracked pending prompt and is replaying
- **AND** a stored `agent_end` is processed during that replay
- **THEN** the session's `currentTool` SHALL be `null` from the event alone
- **AND** the derived value SHALL be applied only at the replay exit

#### Scenario: skipReplayInsert fast path is not folded

- **WHEN** a session has a pending prompt and is in the `skipReplayInsert` state
- **THEN** no pending-prompt reconciliation SHALL be applied on that path
- **AND** the replay exit SHALL establish the derived value instead

#### Scenario: No pending prompt leaves clearing behaviour unchanged

- **WHEN** a session has no pending prompt
- **AND** an `agent_start`, `agent_end`, or `tool_execution_end` event without `parentToolCallId` arrives
- **THEN** the session's `currentTool` SHALL be cleared to `null` exactly as before

#### Scenario: Nested end never clears currentTool
- **WHEN** a session has no pending prompt and `currentTool` is `codemode`
- **AND** a `tool_execution_end` carrying `parentToolCallId` arrives
- **THEN** the session's `currentTool` SHALL remain `codemode`
