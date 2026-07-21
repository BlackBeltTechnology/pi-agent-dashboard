# event-reducer Delta Specification

## MODIFIED Requirements

### Requirement: Full replay state reset
The client's replay-fold decision SHALL be driven by explicit `event_replay` window metadata (`kind`), not by seq heuristics:

- `kind: "tail"` — the batch stream represents a fresh authoritative window. The receiver SHALL reset session state to `createInitialState()` before folding the first batch of the window, then fold subsequent batches of the same window incrementally. `maxSeq` SHALL be rebuilt from the window's events.
- `kind: "delta"` — the batch extends already-seen state. The receiver SHALL preserve existing state and fold the events on top. `maxSeq` advances from the batch tail.
- `kind: "older"` — the batch is history preceding the current window. The receiver SHALL NOT fold it incrementally into existing state; it SHALL prepend the events to the per-session raw event buffer and re-reduce the entire buffer from `createInitialState()` (see `chat-history-pagination`). `maxSeq` SHALL NOT change.
- A batch without `kind` (legacy) SHALL fall back to the previous heuristic: reset when `firstSeq === 1` or `firstSeq <= maxSeqMap.get(sessionId)`, else fold incrementally.

When a reset fires, the optimistic `pendingPrompt` SHALL be carried across the reset (unchanged behavior). An empty events array SHALL preserve state regardless of metadata.

#### Scenario: Tail window resets state
- **WHEN** an `event_replay` with `kind: "tail"` arrives and the client holds prior state for the session
- **THEN** the session state SHALL be reset to `createInitialState()` before folding, and `maxSeq` SHALL be rebuilt from the window's events

#### Scenario: Multi-batch tail window resets exactly once
- **WHEN** a tail window is delivered as batches B1 (`kind: "tail"`, first of window) and B2..Bn (continuations)
- **THEN** the reset SHALL fire only for B1, and B2..Bn SHALL fold incrementally on top

#### Scenario: Delta batch preserves state
- **WHEN** the client has processed events through `seq: 100` and an `event_replay` with `kind: "delta"` arrives starting at `seq: 101`
- **THEN** the existing session state SHALL be preserved and the new events SHALL be reduced on top of it

#### Scenario: Older window never folds incrementally
- **WHEN** an `event_replay` with `kind: "older"` arrives
- **THEN** the receiver SHALL rebuild state by re-reducing the full raw buffer (older events prepended) from `createInitialState()`
- **AND** the receiver SHALL NOT reduce the older events onto the existing reduced state
- **AND** `maxSeqMap` for the session SHALL be unchanged

#### Scenario: Legacy batch without kind uses the seq heuristic
- **WHEN** an `event_replay` without a `kind` field arrives with events starting at `seq: 1`
- **THEN** the session state SHALL be reset to `createInitialState()` before reducing (previous behavior preserved)

#### Scenario: Empty replay preserves state
- **WHEN** an `event_replay` arrives with an empty events array
- **THEN** the existing session state SHALL be preserved (no reset)

## ADDED Requirements

### Requirement: Fold entry tolerates orphan span fragments
The fold entry point (the loop applying replayed events to state) SHALL tolerate a window that begins mid-span (possible only at the hard-cap unsafe cut): leading `message_update`, `message_end`, and `tool_execution_end` events whose opening event is not part of the folded stream SHALL be skipped or absorbed without throwing and without producing phantom rows.

#### Scenario: Leading orphan message_update is dropped
- **WHEN** the oldest available window starts with a `message_update` whose `message_start` precedes the window
- **THEN** folding SHALL NOT throw and SHALL NOT render a partial assistant bubble for the orphan fragment

#### Scenario: Leading orphan tool_execution_end is dropped
- **WHEN** the oldest available window starts with a `tool_execution_end` whose `tool_execution_start` precedes the window
- **THEN** folding SHALL NOT throw and no tool row SHALL be created for the orphan end
