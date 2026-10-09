# subagent-live-reasoning Specification

## Purpose

Show a running subagent's streaming thinking or text live, the way the main
session does, and keep the collapsed running card at a stable height. The
producer sends a bounded `details.liveTail` (last ≤ 280 chars of the streaming
block, or the cleared form `{ kind: "none", text: "" }`) on every snapshot plus
the effective `details.thinkingLevel`; the dashboard renders it as a one-line
ticker on the card and an in-progress block in the inspector. Producers without
`liveTail` render as before.

## Requirements

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

The collapsed card of a running subagent SHALL always render one fixed-height activity row, whether or not `activity` or `liveTail` is present. While a tail is shown, the row SHALL show the kind icon and the sentence being written (markdown markers stripped), fading at the left edge only when it overflows; otherwise it SHALL show the activity.

#### Scenario: Resync tail wins over the tool-call tail
- **WHEN** the session map holds a tail from a resync reply and the tool-call details hold an older one
- **THEN** the card's activity row shows the session-map tail

#### Scenario: Finished block stays up until replaced
- **WHEN** a block ends and its tail clears before the finished entry has reached the client
- **THEN** the card ticker and the inspector keep showing the last tail, the inspector drops it once the timeline grows, and no extra resync request is sent

#### Scenario: Newest reasoning stays open
- **WHEN** the inspector shows a running subagent's timeline
- **THEN** the newest reasoning entry mounts expanded

#### Scenario: Malformed tail is treated as cleared
- **WHEN** a snapshot carries `liveTail` as an object without a valid `kind`/`text`
- **THEN** client state holds the cleared tail and no error is raised

#### Scenario: Activity toggles without layout shift
- **WHEN** a running subagent's ticks alternate between activity present, activity absent, liveTail present, and liveTail absent
- **THEN** the collapsed card's rendered height stays the same across all ticks

#### Scenario: Live preview shown
- **WHEN** a tick carries `liveTail.kind = "thinking"` with text "Done with that. Now batching ctx calls"
- **THEN** the card's activity row shows the thinking icon and "Now batching ctx calls"

### Requirement: The expanded inspector SHALL show the in-progress block

The expanded and popout subagent views SHALL render the in-progress block as a trailing entry after the finished timeline entries, styled like the main chat's live thinking or text block, and SHALL replace it with the finished entry once the block ends. When the producer streams block deltas, the entry SHALL show the full block assembled so far and grow as pieces arrive. Otherwise it SHALL show the current `liveTail`. The collapsed card's one-line ticker SHALL keep using `liveTail`.

#### Scenario: In-progress entry visible before resync
- **WHEN** the inspector is open and a tick carries `liveTail`, but no resync has delivered new entries
- **THEN** the trailing in-progress entry shows the tail text

#### Scenario: Live entry suppresses the empty state
- **WHEN** a running subagent has no finished entries and a non-empty in-progress block
- **THEN** the inspector shows the in-progress entry and does not show "No detail available yet"

#### Scenario: Block grows beyond the tail length
- **GIVEN** a producer streaming block deltas
- **WHEN** a thinking block reaches 1,500 characters
- **THEN** the inspector's in-progress entry shows all 1,500 characters from the block start, not a 280-character window

### Requirement: A running subagent SHALL show its effective thinking level

Once the child session exists, the producer SHALL set `details.thinkingLevel` to the child's effective thinking level. The collapsed card and the inspector header SHALL show it next to the model name. When the field is absent, nothing SHALL render in its place.

#### Scenario: Level shown on the card
- **WHEN** a running subagent's details carry `modelName = "glm-5.3-flash"` and `thinkingLevel = "high"`
- **THEN** the card stats line reads `glm-5.3-flash · thinking high …`

#### Scenario: Effective level reported
- **WHEN** the child session reports a thinking level different from the requested one (clamped)
- **THEN** `details.thinkingLevel` equals the session's level

#### Scenario: Old producer without the field
- **WHEN** details carry no `thinkingLevel`
- **THEN** the stats line has no thinking segment

### Requirement: The dashboard SHALL degrade gracefully for producers without a live tail

A producer that never sends `liveTail` SHALL render as before, except that the stable card layout applies.

#### Scenario: Old producer
- **WHEN** ticks from `pi-dashboard-subagents` 0.2.6 (no `liveTail`) arrive
- **THEN** the card renders its fixed-height activity row showing the activity, with no ticker and no errors
