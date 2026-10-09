# subagent-live-timeline Specification

## Purpose
TBD - created by archiving change add-plugin-bridge-contributions. Update Purpose after archive.

## Requirements

### Requirement: The subagents plugin SHALL declare the subagent step and delta streams

The subagents plugin SHALL ship a bridge entry that declares `subagents:entry` as `{ as: "subagent_entry", delivery: "stream", key: "agentId" }` and `subagents:delta` as `{ as: "subagent_delta", delivery: "stream", key: "agentId" }` through the plugin event-forward registry.

#### Scenario: Steps reach the dashboard while the subagent runs
- **GIVEN** a producer that emits `subagents:entry` for each finished step
- **WHEN** a subagent completes three tool calls while still running
- **THEN** the server SHALL have stored three `subagent_entry` events for that agent before the subagent finishes

### Requirement: The client SHALL build the live timeline from step events

The client SHALL place each `subagent_entry` payload's `entry` at its `index` in the subagent's `entries`, ignoring a duplicate index. A later progress tick or terminal frame whose `entries` is empty or shorter than the streamed list SHALL NOT shrink or replace it. `subagent_entry` and `subagent_delta` SHALL NOT render as raw event rows in the chat.

#### Scenario: Inspector shows tool calls during the run
- **GIVEN** an open inspector for a running subagent
- **WHEN** `subagent_entry` events for a thinking step and a tool step arrive
- **THEN** both steps SHALL be visible in the inspector before the subagent finishes

#### Scenario: Duplicate step is ignored
- **WHEN** the same `subagent_entry` (same agent, same index) is delivered twice
- **THEN** the timeline SHALL contain that step once

#### Scenario: Terminal frame without entries keeps the streamed list
- **GIVEN** ten streamed entries
- **WHEN** a terminal frame arrives with `entries: []` and `entryCount: 10`
- **THEN** the ten streamed entries SHALL remain

### Requirement: The client SHALL assemble the in-progress block from delta pieces

For each subagent the client SHALL keep the in-progress block identified by `blockId`: a piece whose `offset` equals the current text length SHALL be appended; a piece fully covered by the current text SHALL be ignored; a piece whose `offset` exceeds the current length SHALL be appended after a recorded gap. A new `blockId` SHALL replace the previous block. A `subagent_entry` carrying the same `blockId`, or the subagent reaching a terminal state, SHALL clear the in-progress block.

#### Scenario: Block grows across pieces
- **WHEN** pieces `{blockId:0, offset:0, text:"Let me "}` and `{blockId:0, offset:7, text:"check"}` arrive
- **THEN** the in-progress block text SHALL be `Let me check`

#### Scenario: Finished entry replaces the block without a blank gap
- **GIVEN** an in-progress block `blockId: 3`
- **WHEN** the final piece and then a `subagent_entry` with `blockId: 3` arrive
- **THEN** the inspector SHALL show the finished entry and no in-progress block, with no render in between that shows neither

#### Scenario: Missing piece is marked, not silently joined
- **WHEN** a piece with `offset` greater than the current text length arrives
- **THEN** the block SHALL show a gap marker between the old text and the new piece

#### Scenario: Late delta after its entry does not resurrect the block
- **GIVEN** a `subagent_entry` with `blockId: 4` already applied
- **WHEN** a `subagent_delta` with `blockId: 4` arrives afterwards
- **THEN** no in-progress block SHALL be shown

#### Scenario: Delta after terminal is ignored
- **GIVEN** a subagent in a terminal state
- **WHEN** a `subagent_delta` for it arrives
- **THEN** no in-progress block SHALL be shown

#### Scenario: Entry before its final piece
- **GIVEN** an in-progress block `blockId: 2`
- **WHEN** the `subagent_entry` with `blockId: 2` arrives before the block's final piece, and the final piece arrives after it
- **THEN** the inspector SHALL show the finished entry and no in-progress block

### Requirement: Streamed pieces SHALL be stored losslessly

The server SHALL store `subagent_delta` text without the per-string-field cap; the per-event ceiling still applies. A piece that exceeds the per-event ceiling SHALL be stored with its envelope fields (`agentId`, `toolCallId`, `blockId`, `kind`, `offset`, `final`), empty `text`, and `omittedLength` set to the omitted text length, and the client SHALL show a gap in that block until the block's finished entry arrives. Removing stored deltas SHALL update the store's byte accounting and SHALL NOT renumber event sequence numbers.

#### Scenario: Large piece survives storage
- **WHEN** a single `subagent_delta` with 100,000 characters of text is stored and replayed
- **THEN** the replayed in-progress block SHALL equal the original 100,000 characters with no gap marker

#### Scenario: Over-ceiling piece degrades to a gap
- **WHEN** a `subagent_delta` whose text exceeds the per-event ceiling is stored, followed by the block's `subagent_entry`
- **THEN** the replayed in-progress block SHALL show a gap marker until the entry, and the finished entry SHALL then show the full text

#### Scenario: Raw and compacted replay agree
- **GIVEN** a stored run with finished entries and an open block
- **WHEN** the session is replayed raw and through replay compaction
- **THEN** both SHALL produce the same subagent timeline and in-progress block

### Requirement: Reload SHALL restore the live timeline from storage

After a browser reload or popout of a running subagent, the stored `subagent_entry` events and the stored deltas of the open block SHALL rebuild the same timeline and in-progress block. Delta and entry messages of one subagent SHALL reach the server in their original emission order, including after a not-ready or disconnected period. The server SHALL drop stored `subagent_delta` events of a block once a `subagent_entry` with that `blockId` is stored, and all remaining deltas of an agent once its terminal event is stored.

#### Scenario: Reload mid-run restores steps and the open block
- **GIVEN** a running subagent with five stored steps and an open block of 400 characters
- **WHEN** the browser reloads
- **THEN** the inspector SHALL show the five steps and the 400-character in-progress block

#### Scenario: Finished block's deltas are not retained
- **WHEN** a `subagent_entry` with `blockId: 2` is stored
- **THEN** no `subagent_delta` with `blockId: 2` for that agent SHALL remain in the store

### Requirement: The healed Agent card SHALL show the subagent result

When an Agent tool row was finalized by a heal (superseded or session-ended) and the subagent state holds a non-empty `result`, the collapsed card SHALL render the subagent `result` instead of the sentinel and SHALL keep the recovered indicator.

#### Scenario: Card after a supersede heal
- **GIVEN** an Agent tool row healed with the sentinel and a `subagent_completed` that carried result `Done. Wrote x.md`
- **WHEN** the card renders collapsed
- **THEN** it SHALL show `Done. Wrote x.md` and the recovered indicator, not the sentinel text

#### Scenario: Card after a session-ended heal
- **GIVEN** an Agent tool row healed with `healedBy: "session_ended"` and a subagent state whose result is `Summary ready`
- **WHEN** the card renders collapsed
- **THEN** it SHALL show `Summary ready`, not the session-ended placeholder

### Requirement: Legacy producers SHALL keep working

A producer that emits neither `subagents:entry` nor `subagents:delta` SHALL render as before: timeline from ticks, resync, and terminal frames; in-progress block from `liveTail`.

#### Scenario: Producer 0.2.x
- **GIVEN** a producer that sends `entries` on ticks and no step events
- **WHEN** its subagent runs
- **THEN** the inspector SHALL show its timeline via the existing tick and resync path
