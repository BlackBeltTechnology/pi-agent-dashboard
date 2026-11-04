# Spec Delta

## MODIFIED Requirements

### Requirement: Replay reconstructs persisted flow runs

`replayEntriesAsEvents` SHALL synthesize `event_forward` messages from persisted flow-run entries so a flow card rebuilds after `/resume`, browser refresh, or dashboard server restart. It SHALL do so through the generic `plugin-entry-replay` path: `flow-event` is replayed because the enabled flows plugin declares it in `replayEntryTypes`, not because core names it.

For each session entry where `entry.type === "custom"` AND `entry.customType` is a declared replay entry type (for flows, `"flow-event"`), replay SHALL read the record shape `{ seq: number, eventType: string, data: unknown }` and emit one `event_forward` message carrying that record's `eventType` and `data` verbatim. The `eventType` is already the dashboard protocol name (e.g. `flow_tool_call`), so replay SHALL NOT re-map it.

Replay SHALL order the emitted declared-entry messages by ascending `seq`. The record type is duck-typed; replay SHALL NOT import any type from pi-flows or from the flows plugin.

Malformed records (missing or non-string `eventType`) SHALL be skipped without throwing.

#### Scenario: Persisted flow events replayed in seq order
- **GIVEN** the flows plugin is enabled
- **WHEN** a session JSONL contains `flow-event` custom entries with `seq` 0,1,2 mapping to `flow_started`, `flow_agent_started`, `flow_tool_call`
- **THEN** `replayEntriesAsEvents` SHALL emit three `event_forward` messages with those `eventType` values, in `seq` order, each carrying the record's `data`

#### Scenario: Custom non-flow entries ignored
- **WHEN** a session JSONL contains a `type:"custom"` entry whose `customType` is not a declared replay entry type
- **THEN** replay SHALL NOT emit an `event_forward` for it

#### Scenario: Malformed flow-event record skipped
- **WHEN** a `flow-event` custom entry has a missing or non-string `eventType`
- **THEN** replay SHALL skip the entry and continue without throwing

#### Scenario: Existing message and model_change replay unaffected
- **WHEN** a session JSONL contains `message` and `model_change` entries alongside `flow-event` entries
- **THEN** replay SHALL still synthesize the message and model_change events exactly as before, in addition to the flow-event messages

#### Scenario: Flows plugin disabled
- **GIVEN** the flows plugin is disabled
- **WHEN** a session JSONL contains `flow-event` custom entries
- **THEN** replay SHALL NOT emit any `flow_*` `event_forward` for them
