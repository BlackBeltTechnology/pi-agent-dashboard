# Spec Delta

## Purpose

Lets a plugin declare the persisted custom-entry types it owns so core replays them as their recorded protocol events, flow-agnostically, and keeps them out of the generic custom-entry rendering.

## ADDED Requirements

### Requirement: Plugin manifest declares owned replay entry types
A plugin manifest SHALL be able to declare `pi-dashboard-plugin.replayEntryTypes: string[]`, naming the persisted `type: "custom"` entry `customType` values the plugin owns. The flows plugin SHALL declare `["flow-event"]`. Only enabled plugins SHALL contribute their declared types. The declared set SHALL come from manifests, so replay works for offline sessions with no live bridge.

#### Scenario: Flows plugin declares flow-event
- **WHEN** the dashboard server discovers plugin manifests with the flows plugin enabled
- **THEN** the declared replay entry type set SHALL contain `flow-event`

#### Scenario: Disabled plugin contributes nothing
- **GIVEN** `plugins.flows.enabled = false`
- **WHEN** the declared replay entry type set is computed
- **THEN** it SHALL NOT contain `flow-event`

### Requirement: Declared entries replay seq-ordered as their recorded protocol events
For each persisted `type: "custom"` entry whose `customType` is in the declared set, `replayEntriesAsEvents` SHALL read the duck-typed record `{ seq: number, eventType: string, data: unknown }` and emit one `event_forward` carrying `eventType` and `data` verbatim, without re-mapping. Emitted messages SHALL be ordered by ascending `seq`. Message and `model_change` replay SHALL be unaffected.

#### Scenario: Declared records replayed in seq order
- **GIVEN** `flow-event` is declared
- **WHEN** a session JSONL holds `flow-event` entries with `seq` 2, 0, 1 for `flow_tool_call`, `flow_started`, `flow_agent_started`
- **THEN** replay SHALL emit `event_forward` messages `flow_started`, `flow_agent_started`, `flow_tool_call` in that order, each with its record `data`

#### Scenario: Other replay output unchanged
- **WHEN** a session JSONL holds `message` and `model_change` entries alongside declared entries
- **THEN** replay SHALL synthesize the message and `model_change` events exactly as before, in addition to the declared-entry events

### Requirement: Malformed declared records are skipped
A declared-type record with a missing or non-string `eventType` SHALL be skipped without throwing, and replay SHALL continue with the remaining entries.

#### Scenario: Missing eventType skipped
- **WHEN** a declared `flow-event` entry has no `eventType`
- **THEN** replay SHALL emit nothing for it and SHALL continue without throwing

### Requirement: Declared entry types are excluded from generic custom-entry paths
Entries whose `customType` is in the declared set SHALL NOT be replayed as `custom_entry` events or custom-message rows, and the bridge SHALL NOT forward a live `entry_appended` for them as a `custom_entry` event.

#### Scenario: No generic replay row for a declared entry
- **WHEN** replay encounters a declared `flow-event` entry
- **THEN** it SHALL NOT emit a `custom_entry` event for it

#### Scenario: No live generic forward for a declared entry
- **WHEN** pi-flows calls `pi.appendEntry("flow-event", ...)` while `flow-event` is declared
- **THEN** the bridge SHALL NOT send a `custom_entry` event for it

### Requirement: Undeclared plugin entries stay hidden
When the owning plugin is disabled, its entry type is not declared; such entries SHALL NOT be replayed as protocol events and SHALL NOT render as a generic custom card.

#### Scenario: Disabled flows plugin hides persisted flow runs
- **GIVEN** `plugins.flows.enabled = false`
- **WHEN** a session with persisted `flow-event` entries is replayed
- **THEN** no `flow_*` event SHALL be emitted and no custom card SHALL render for those entries

### Requirement: Core names no plugin entry type
Core replay and live custom-entry forwarding SHALL take the declared set as input and SHALL NOT name any plugin entry type (such as `flow-event`) in source.

#### Scenario: Core source carries no flow-event literal
- **WHEN** `packages/shared/src/state-replay.ts` and `packages/extension/src/custom-entry-forward.ts` are inspected
- **THEN** neither SHALL contain the string literal `flow-event`

### Requirement: Declared entry replay covers only persisted entries
Replay of declared entry types SHALL cover only entries pi has persisted to the session file. The on-demand-session-replay KNOWN BLOCKER applies: pi flushes custom entries only after the first assistant message, so a flow-first session reloaded before that message SHALL have no replayable `flow-event` entries and SHALL replay no `flow_*` event, without error.

#### Scenario: Flow-first session reloaded before the first assistant message
- **GIVEN** a session that started a flow before any assistant message, so pi has not flushed its `flow-event` entries
- **WHEN** the session is reloaded and replayed
- **THEN** replay SHALL emit no `flow_*` event and SHALL NOT throw

#### Scenario: Persisted entries replay after the flush
- **GIVEN** a session whose `flow-event` entries pi persisted after the first assistant message
- **WHEN** the session is replayed with `flow-event` declared
- **THEN** replay SHALL emit the recorded `flow_*` events

### Requirement: Extra record fields are tolerated and ignored
A declared-type record MAY carry fields beyond `{ seq, eventType, data }` (pi-flows adds `flowRunId`). Replay SHALL tolerate such fields and SHALL ignore them: the emitted `event_forward` SHALL carry only the record's `eventType` and `data`.

#### Scenario: flowRunId ignored on replay
- **WHEN** a declared `flow-event` record is `{ seq: 0, eventType: "flow_started", data: { flowName: "research" }, flowRunId: "run-1" }`
- **THEN** replay SHALL emit an `event_forward` with `eventType: "flow_started"` and data `{ flowName: "research" }`
- **AND** SHALL NOT throw or skip the record
