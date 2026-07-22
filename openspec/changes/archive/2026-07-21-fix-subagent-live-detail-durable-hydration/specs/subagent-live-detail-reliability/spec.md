## ADDED Requirements

### Requirement: Running subagent timeline hydrated from the durable partialResult channel

The reducer SHALL hydrate a running subagent's `session.subagents` entry from the **durable** Agent-tool `partialResult` (`tool_execution_update`) channel, not only from the ephemeral `subagents:*` `event_forward` frames and the `tool_execution_end` completion backfill. When a structured `tool_execution_update` for a row whose `toolName` is `Agent` carries `details.agentId`, the reducer SHALL derive a `SubagentState` from that `details` snapshot (reusing the same detail-mapping + dual-index used by the completion backfill) and write it into `session.subagents` under the `agentId` key — and, when `details.agentSessionId` is present, ALSO under that key (same object reference).

The hydration SHALL be non-regressing: when the existing `SubagentState` for that `agentId` is already terminal (`completed` or `failed`), a later running `tool_execution_update` SHALL NOT reset its status to `running`. The mapping SHALL introduce no new bounded structure and SHALL be self-selecting — only the Agent tool's `details` carry `agentId`, so ordinary tools' partial results SHALL NOT touch `session.subagents`.

Because the durable channel survives the bridge-not-ready buffering and the server→browser WS back-pressure drops that can lose ephemeral frames (and lose the resync reply), the subagent inspector SHALL render the live timeline — or the correct running "No detail available yet." state once a map entry exists — rather than the "Subagent not found in this session." placeholder, for the whole run under load.

#### Scenario: Running partialResult hydrates the inspector map live

- **GIVEN** an Agent tool row and a `tool_execution_update` whose `partialResult.details` carry `agentId`, `status: "running"`, and a non-empty `entries[]`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents.get(agentId)` SHALL be defined with `status: "running"` and the given `entries[]`
- **AND** when `details.agentSessionId` is present, `session.subagents.get(agentSessionId)` SHALL return the SAME `SubagentState` reference

#### Scenario: Late running partial does not regress a completed subagent

- **GIVEN** an Agent subagent whose `SubagentState` is already `completed` (via `tool_execution_end`)
- **WHEN** a late/reordered running `tool_execution_update` for the same `agentId` is processed
- **THEN** the `SubagentState` status SHALL remain `completed` (no regression to `running`)

#### Scenario: Non-Agent partialResult does not touch the subagents map

- **GIVEN** a non-Agent tool row and a structured `tool_execution_update` whose `details` carry no `agentId`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents` SHALL be unchanged
