## ADDED Requirements

### Requirement: Compactions pi does not announce are announced live by the bridge
pi persists a `compaction` entry returned from a `turn_end` or `agent_before_settle` boundary without emitting `session_compact`. The bridge SHALL collect `compaction` entries appended to the session: at each of its existing non-message usage drain points, and by a read-only look past that drain's cursor at `turn_start` that SHALL NOT move the cursor. It SHALL flush the collected entries at `turn_start` (before the `turn_start` event is forwarded), at `agent_settled` (before the `agent_settled` event is forwarded, and therefore before any follow-up drain or retry-chain close it triggers) and at `session_shutdown` (before `session_unregister`). For each flushed entry whose id is not in the session's announced set, the bridge SHALL forward one `session_compact` event, built like the replay converter's (the entry's timestamp, no `reason`, no `willRetry`, no `compactionEntry`), in entry order, and SHALL add its id to the announced set.

The announced set SHALL hold the entry id of every `session_compact` the bridge forwards, live or synthesized, and of every `compaction` entry present in the entry snapshot it replays on register, reconnect or fork. The pending list and the announced set SHALL be cleared on session change and shutdown. The usage drain's cursor and drain points SHALL be unchanged.

#### Scenario: Mid-run boundary compaction shows a divider live
- **WHEN** an extension returns a compaction draft at `turn_end` and the run continues
- **THEN** the forwarded stream contains one `session_compact` event before the next `turn_start` event
- **AND** reducing it produces exactly one compaction boundary row

#### Scenario: End-of-run boundary compaction
- **WHEN** an extension returns a compaction draft at `agent_before_settle`
- **THEN** one `session_compact` event is forwarded before the `agent_settled` event

#### Scenario: An announced compaction is not duplicated
- **WHEN** pi's own compaction emits `session_compact` and the bridge forwards it
- **THEN** no synthesized event is forwarded for that entry

#### Scenario: Peek then drain announces once
- **WHEN** a boundary compaction is first seen by the `turn_start` peek of turn N and then passed again by the `turn_end` usage drain of turn N
- **THEN** exactly one `session_compact` is forwarded for it across turns N and N+1

#### Scenario: Compaction just before shutdown
- **WHEN** a boundary compaction is persisted on the last turn and the session shuts down without another `turn_start` or `agent_settled`
- **THEN** its `session_compact` is forwarded before `session_unregister`

#### Scenario: Reconnect between compaction and flush
- **WHEN** a boundary compaction is persisted, the bridge reconnects and replays the branch before the next `turn_start`, and a turn then starts
- **THEN** exactly one compaction boundary row is present

#### Scenario: Branch navigation
- **WHEN** the user navigates to another branch with `/tree` and a boundary compaction then happens there
- **THEN** exactly one `session_compact` is forwarded for it

#### Scenario: Ordering against settle handling
- **WHEN** a boundary compaction is persisted at `agent_before_settle` and a follow-up prompt is queued
- **THEN** the synthesized `session_compact` is forwarded before `agent_settled` and before the follow-up prompt is sent

#### Scenario: Usage totals unchanged
- **WHEN** a boundary compaction carrying `usage` is persisted
- **THEN** its usage is forwarded once as `usage_recorded`, exactly as without this requirement

#### Scenario: Check budget
- **WHEN** 1,000 `turn_start` looks run on a 2,000-entry session with no new entry
- **THEN** the p95 time is below 0.5 ms

## MODIFIED Requirements

### Requirement: Cold replay and live streaming do not double-render a compaction

A compaction SHALL be rendered exactly once per session view. Synthesized compaction events SHALL be subject to the same register-time reset semantics as every other replayed event — store wipe plus client state reset, or replay-insert suppression. The only compaction-specific dedup path SHALL be the bridge's announced-id set for live announcement of compactions pi does not announce (see "Compactions pi does not announce are announced live by the bridge"); replay-versus-live rendering SHALL NOT use it.

#### Scenario: Warm session keeps a single boundary

- **WHEN** a session compacts while it is being streamed live and the browser stays subscribed
- **THEN** exactly one compaction boundary row SHALL be present

#### Scenario: Reloaded session keeps a single boundary

- **WHEN** the same session is later reopened after its events were evicted and reloaded from disk
- **THEN** exactly one compaction boundary row SHALL be present

#### Scenario: Reconnect replay keeps a single boundary

- **WHEN** a session that already rendered a live compaction boundary reconnects, and the bridge replays its branch
- **THEN** exactly one compaction boundary row SHALL be present after the replay completes
