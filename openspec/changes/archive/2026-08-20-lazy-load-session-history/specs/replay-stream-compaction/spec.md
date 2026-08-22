## ADDED Requirements

### Requirement: Compaction accepts an explicit supersession boundary

`compactEventsForReplay` SHALL accept an optional supersession boundary supplied by the caller. When supplied, that boundary SHALL be used in place of the last `message_end` located within the passed array. When omitted, behavior SHALL be identical to the prior implementation.

#### Scenario: Omitted boundary preserves existing behavior

- **WHEN** compaction is invoked without an explicit boundary
- **THEN** it SHALL drop exactly the events the prior implementation dropped

#### Scenario: Supplied boundary supersedes the whole slice

- **WHEN** compaction is invoked on a middle slice with a boundary indicating a later `message_end` exists outside the slice
- **THEN** every non-exempt `message_update` in the slice SHALL be dropped

#### Scenario: Exemptions hold under a supplied boundary

- **WHEN** compaction is invoked on a slice with an external boundary, and the slice contains a thinking update and a text-bearing update immediately preceding a `tool_execution_start`
- **THEN** both of those updates SHALL be retained

### Requirement: The replay window is applied after compaction

When a window is applied to a replay, it SHALL be applied to the compacted event array, not to the raw stored array.

#### Scenario: Budget is spent on compacted events

- **WHEN** a stored stream of 20000 events compacts to 1000 events and the window limit is 500
- **THEN** the delivered events SHALL be drawn from the 1000 compacted events
- **AND** the delivered count SHALL be at most 500

#### Scenario: Compaction still precedes batching

- **WHEN** a windowed replay is delivered
- **THEN** every delivered event SHALL have survived compaction
