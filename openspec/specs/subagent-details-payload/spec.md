# subagent-details-payload Specification

## Purpose

Bound the size of a subagent progress tick. An intermediate tick is O(1) in
timeline length rather than linear: the cumulative `details.entries[]` timeline
is stripped from frames describing a non-terminal subagent, and recovered on
demand through the existing resync pull path. Terminal frames and resync replies
carry the full timeline, so a finished run replays exactly as before. Mid-run
replay yields scalar state until a resync is served.

## Requirements

### Requirement: An intermediate subagent tick SHALL NOT carry the cumulative timeline

A forwarded `subagent_*` / `tool_execution_update` frame describing a subagent
in a NON-terminal state SHALL NOT carry `details.entries`. The timeline SHALL be
delivered by the per-step entry stream, and on terminal frames.

For `subagent_*` bus frames the producer (≥ 0.3.0) already omits `entries` on
progress ticks, and the dashboard SHALL NOT strip them again. For `Agent`
`tool_execution_update` frames, which still carry `entries` while running, the
subagents plugin SHALL drop `details.entries` through its declared tool-update
filter.

Rationale: retention was bounded by
`collapse-superseded-tool-execution-updates` (36 → 2 retained ticks per
`toolCallId`), but average bytes/event ROSE (1240 → 1350 B) because the cost is
concentrated in the surviving payloads. The timeline is pull-consumed (it
renders only in an expanded inspector) but was push-fanned-out on every tick.

Every frame SHALL remain an idempotent FULL snapshot of the state it describes,
preserving latest-supersedes semantics at every hop.

#### Scenario: A long-running subagent's tick size stays flat

- **GIVEN** a subagent whose accumulated timeline grows from 10 to 100 entries
- **WHEN** it emits successive progress ticks across that growth
- **THEN** serialized tick payload size SHALL grow by no more than **2x**
  across that 10x growth in entry count
- **AND** the bound SHALL be asserted against the serialized bytes actually
  broadcast, not against the in-memory object

#### Scenario: A run that dies without a terminal frame degrades predictably

- **GIVEN** a subagent run whose process is killed before any terminal frame is
  emitted
- **WHEN** its session is later replayed
- **THEN** the stored stream SHALL yield the timeline rebuilt from its stored
  `subagent_entry` events, with no step lost that was stored before the kill

#### Scenario: The timeline is served on demand from retained state

- **GIVEN** a consumer holding NO timeline for a subagent that is still running
  (a reconnect, a replay, or a browser opened after the run started)
- **WHEN** it subscribes to the session
- **THEN** it SHALL rebuild the full timeline from the stored and carried
  `subagent_entry` events, without sending any request to the session

#### Scenario: An open inspector keeps receiving timeline updates

- **GIVEN** a subagent detail view mounted for a RUNNING subagent
- **WHEN** the subagent appends entries to its timeline
- **THEN** the rendered timeline SHALL converge to current state without
  requiring the user to close and reopen the view

#### Scenario: A terminal frame still carries the full timeline

- **GIVEN** a subagent reaching any terminal state — `completed`, `failed`,
  `aborted`, or an early-error exit
- **WHEN** the terminal frame is forwarded
- **THEN** it SHALL carry the full `details.entries` timeline unchanged
- **AND** a replay of the finished run SHALL render the same timeline as before
  this change

#### Scenario: A reduced stream folds to the same terminal state

- **GIVEN** a session recorded before this change
- **AND** the same session recorded after it
- **WHEN** each is folded by the client reducer, live and via replay
- **THEN** both SHALL yield the same rendered subagent state AT AND AFTER the
  terminal frame, preserving the accumulative merge, the `entries` empty-array
  overwrite guard, and first-wins `type`/`description`

#### Scenario: The dashboard stays correct against every producer version

- **GIVEN** any `pi-dashboard-subagents` version at or above the plugin's
  declared minimum (0.7.0)
- **WHEN** it runs against a dashboard implementing this requirement
- **THEN** the subagent timeline SHALL still render correctly
- **AND** no producer change, capability flag, or version negotiation SHALL be
  required

#### Scenario: Bus progress frames are forwarded as emitted

- **GIVEN** a producer ≥ 0.3.0 emitting a `subagents:started` progress tick
- **WHEN** the bridge forwards it
- **THEN** the forwarded payload SHALL equal the emitted payload

### Requirement: The crash-without-terminal-frame regression SHALL be pinned

A run that terminates without emitting a terminal frame SHALL replay with the
timeline rebuilt from its stored `subagent_entry` events, and the render SHALL be
neither corrupt nor blank. The subagent SHALL end in a terminal state once the
session-ended heal of the subagents plugin has run.

#### Scenario: pi killed mid-run, session replayed

- **GIVEN** a subagent running with 12 stored `subagent_entry` events
- **WHEN** the pi process is killed before any terminal frame is emitted
- **AND** the session is replayed afterwards
- **THEN** the subagent renders its scalar state and the 12 stored steps
- **AND** the render is neither corrupt nor blank
