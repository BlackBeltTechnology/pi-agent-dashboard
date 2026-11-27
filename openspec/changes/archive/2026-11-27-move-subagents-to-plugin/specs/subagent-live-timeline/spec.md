# Spec Delta

## MODIFIED Requirements

### Requirement: Reload SHALL restore the live timeline from storage

After a browser reload or popout of a running subagent, the stored `subagent_entry` events and the stored deltas of the open block SHALL rebuild the same timeline and in-progress block. Delta and entry messages of one subagent SHALL reach the server in their original emission order, including after a not-ready or disconnected period. The server SHALL drop stored `subagent_delta` events of a block once a `subagent_entry` with that `blockId` is stored, and all remaining deltas of an agent once its terminal event is stored. When the session replay is windowed, the subagents plugin SHALL carry, for every subagent not terminal before the tail, its `subagent_created`, its latest `subagent_started`, its `subagent_entry` events and the deltas of its open block, and the terminal frame of every subagent with a frame in the head whose terminal frame lies in the gap, so the rebuilt state is the same as with a full replay.

#### Scenario: Reload mid-run restores steps and the open block
- **GIVEN** a running subagent with five stored steps and an open block of 400 characters
- **WHEN** the browser reloads
- **THEN** the inspector SHALL show the five steps and the 400-character in-progress block

#### Scenario: Finished block's deltas are not retained
- **WHEN** a `subagent_entry` with `blockId: 2` is stored
- **THEN** no `subagent_delta` with `blockId: 2` for that agent SHALL remain in the store

#### Scenario: Windowed replay keeps an early-started subagent whole
- **GIVEN** a session with 16000 events whose replay is windowed, and background subagent a1 created at seq 9000 with entries 0-79 at seqs 9001-13900 and entries 80-90 in the tail
- **WHEN** the browser loads the session
- **THEN** a1's row SHALL show its producer type and description, and its timeline SHALL show entries 0-90 with no gap

#### Scenario: Finished subagent is not carried
- **GIVEN** subagent a2 completed at seq 5000, inside the gap
- **WHEN** the browser loads the windowed session
- **THEN** none of a2's gap events SHALL be carried

#### Scenario: Subagent created in the head and finished in the gap
- **GIVEN** subagent a3 created at seq 150 (head) and completed at seq 6000 (gap)
- **WHEN** the browser loads the windowed session
- **THEN** a3's `subagent_completed` SHALL be carried and a3 SHALL show as completed, not running

## REMOVED Requirements

### Requirement: Legacy producers SHALL keep working
**Reason**: The dashboard requires pi ≥ 1.6.0, so producers ≤ 0.2.5 cannot run. The tick-timeline and resync path this requirement relied on is removed.
**Migration**: Use `pi-dashboard-subagents` ≥ 0.7.0. Older producers get the unsupported-producer notice (`subagents-core-boundary`).
