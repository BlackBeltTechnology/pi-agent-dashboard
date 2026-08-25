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
delivered on demand, and on terminal frames.

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
- **THEN** the stored stream SHALL yield scalar subagent state with no mid-run
  timeline
- **AND** this degradation SHALL be documented and asserted by a test, since it
  is a REGRESSION against the prior behaviour where fat intermediate ticks
  replayed a partial timeline

#### Scenario: The timeline is served on demand from retained state

- **GIVEN** a consumer holding NO timeline for a subagent that is still running
  (a reconnect, a replay, or a browser opened after the run started)
- **WHEN** it requests a resync for that subagent
- **THEN** it SHALL receive a FULL timeline snapshot reflecting current state
- **AND** the snapshot SHALL be subject to the same truncation ceilings as
  today's full-payload frames

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
- **AND** mid-run, the reduced stream MAY render scalar state only until a
  resync is served — that difference SHALL be recoverable, never a silent
  permanent loss

#### Scenario: The dashboard stays correct against every producer version

- **GIVEN** any published `pi-dashboard-subagents` version, all of which send
  full cumulative payloads
- **WHEN** it runs against a dashboard implementing this requirement
- **THEN** the subagent timeline SHALL still render correctly
- **AND** no producer change, capability flag, or version negotiation SHALL be
  required, because the reduction happens downstream of the producer

### Requirement: The open-inspector pull path SHALL be verified against a watched, growing timeline

The parent change's cadence is asserted only at the hook level. A mounted
inspector watching a RUNNING subagent SHALL be shown to converge on the rendered
timeline, and the cost of that pull SHALL be measured against the push traffic it
replaced.

#### Scenario: A mounted inspector converges on a growing timeline

- **GIVEN** a subagent that stays running long enough to be observed
- **AND** its inspector is mounted before the timeline grows
- **WHEN** the timeline grows from 5 to 30 entries
- **THEN** the RENDERED entry count converges to 30
- **AND** no close/reopen of the inspector is required

#### Scenario: The cadence costs no more than the push it replaced

- **GIVEN** the same workload with N inspectors held open
- **WHEN** resync replies/s and per-subscriber reply bytes/s are measured
- **THEN** the reply byte rate SHALL NOT exceed the push byte rate the strip removed
- **AND** exceeding it SHALL trigger the D4 v2 escalation rather than a cadence tweak

#### Scenario: The inspector-open share is measured representatively

- **GIVEN** a workload in which inspectors ARE opened during subagent runtime
- **WHEN** the inspector-open share of subagent runtime is read
- **THEN** the recorded number SHALL come from that watched workload, not from an unwatched run
- **AND** a share above 50 % SHALL be reported as the C4 kill-switch condition

### Requirement: The crash-without-terminal-frame regression SHALL be pinned

A run that terminates without emitting a terminal frame SHALL replay as scalar
state with no mid-run timeline, and the render SHALL be neither corrupt nor
blank. The parent change documents this regression but leaves it unexercised,
which is how a documented regression quietly becomes an undocumented one.

#### Scenario: pi killed mid-run, session replayed

- **GIVEN** a subagent running with an accumulated timeline
- **WHEN** the pi process is killed before any terminal frame is emitted
- **AND** the session is replayed afterwards
- **THEN** the subagent renders its scalar state
- **AND** no mid-run timeline is shown
- **AND** the render is neither corrupt nor blank

