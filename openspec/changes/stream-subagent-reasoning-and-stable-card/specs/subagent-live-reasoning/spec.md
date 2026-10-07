## Purpose

Shows a running subagent's in-progress reasoning and text in the chat card and inspector, the way the main session does, while keeping the card's height stable and the intermediate-tick payload bounded.

## ADDED Requirements

### Requirement: A running subagent SHALL expose a bounded live tail of its streaming block

While a subagent streams a thinking or text block, its `details` snapshot SHALL carry `liveTail = { kind: "thinking" | "text", text }`. `text` holds at most the last 280 characters of the block streamed so far. A producer that supports `liveTail` SHALL include the key on every snapshot it emits, terminal ones included. When no block is streaming, the value SHALL be the cleared form `{ kind: "none", text: "" }`. The key SHALL never be omitted to signal clearing. When a block ends, the finished block SHALL become a timeline entry as it does today. `liveTail` SHALL NOT be stripped from non-terminal frames, and it SHALL NOT increase tick frequency beyond the existing producer throttle.

#### Scenario: Thinking streams into the tail
- **WHEN** a running subagent emits thinking deltas totalling 1000 characters
- **THEN** the next tick carries `liveTail.kind = "thinking"` and `liveTail.text` equal to the last ≤ 280 characters

#### Scenario: Tail clears on block end
- **WHEN** the thinking block ends
- **THEN** subsequent ticks carry `liveTail = { kind: "none", text: "" }`, and the timeline gains a complete `thinking` entry

#### Scenario: Cleared tail is cleared in client state, live and on replay
- **WHEN** a session with several `liveTail` blocks followed by a terminal frame is folded by the client reducer, both live and via raw and compacted replay
- **THEN** the final subagent state has the cleared tail, and each block-end snapshot subsumes its predecessor in the event store (same key, same type)

#### Scenario: Tick size stays flat
- **WHEN** a subagent's timeline grows from 10 to 100 entries while streaming
- **THEN** the serialized intermediate tick grows by no more than 2x (the `subagent-details-payload` bound holds with `liveTail` present)

### Requirement: The activity indicator SHALL NOT flicker between steps

A running subagent's `activity` SHALL always hold its latest known state. Finishing a tool call SHALL NOT clear it to empty.

#### Scenario: Tool end keeps activity
- **WHEN** a subagent finishes a tool call and has not yet started its next block
- **THEN** the tick still carries a non-empty `activity`

### Requirement: The collapsed running card SHALL keep a stable height

The collapsed card of a running subagent SHALL always render its activity row and its live-preview row at fixed heights, whether or not `activity` or `liveTail` is present. The preview row SHALL show `liveTail` clamped to its fixed height, styled as thinking or text to match the main chat.

#### Scenario: Resync clears a stale tail on the card
- **WHEN** the collapsed card shows a tail and a resync reply arrives carrying the cleared tail
- **THEN** the card's preview row empties

#### Scenario: Malformed tail is treated as cleared
- **WHEN** a snapshot carries `liveTail` as an object without a valid `kind`/`text`
- **THEN** client state holds the cleared tail and no error is raised

#### Scenario: Activity toggles without layout shift
- **WHEN** a running subagent's ticks alternate between activity present, activity absent, liveTail present, and liveTail absent
- **THEN** the collapsed card's rendered height stays the same across all ticks

#### Scenario: Live preview shown
- **WHEN** a tick carries `liveTail.kind = "thinking"`
- **THEN** the collapsed card shows the tail text in the thinking style

### Requirement: The expanded inspector SHALL show the in-progress block

The expanded and popout subagent views SHALL render the current `liveTail` as a trailing in-progress entry after the finished timeline entries, and SHALL replace it with the finished entry once the block ends.

#### Scenario: In-progress entry visible before resync
- **WHEN** the inspector is open and a tick carries `liveTail`, but no resync has delivered new entries
- **THEN** the trailing in-progress entry shows the tail text

#### Scenario: Live entry suppresses the empty state
- **WHEN** a running subagent has no finished entries and a non-empty `liveTail`
- **THEN** the inspector shows the in-progress entry and does not show "No detail available yet" 

### Requirement: The dashboard SHALL degrade gracefully for producers without a live tail

A producer that never sends `liveTail` SHALL render as before, except that the stable card layout applies.

#### Scenario: Old producer
- **WHEN** ticks from `pi-dashboard-subagents` 0.2.6 (no `liveTail`) arrive
- **THEN** the card renders with an empty, fixed-height preview row and no errors
