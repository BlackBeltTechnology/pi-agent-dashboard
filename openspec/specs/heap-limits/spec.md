# heap-limits Specification

## Purpose
Bounds the V8 heap of the processes the dashboard starts — spawned pi sessions
and the dashboard server itself — through operator-visible configuration, so a
ceiling is a deliberate, measurable choice rather than an accident of inherited
environment.

## Requirements

### Requirement: Heap limits are operator-configurable

The dashboard SHALL read heap sizing from two independent top-level
configuration blocks: `sessionHeap`, governing spawned pi sessions, and
`serverHeap`, governing the dashboard server process.

Each block SHALL support `maxOldSpaceMb`. `sessionHeap` SHALL additionally
support `initialOldSpaceMb` and `maxSemiSpaceMb`, both unset by default.

`sessionHeap.maxOldSpaceMb` SHALL default to `512`. `serverHeap.maxOldSpaceMb`
SHALL default to `1536`, replacing the previously hardcoded `8192`.

The `1536` default is derived from a measured ~112 MB non-store baseline plus
the 768 MiB event-store budget expressed **as heap** (~1024 MB — the budget
counts serialized `data` bytes, not V8 heap bytes) plus hysteresis slack,
giving a steady-state live set of ~1187 MB against a ~1417 MB effective crash
point: **~84% occupancy, an accepted trade-off rather than a comfortable
margin**. Operators whose telemetry shows sustained pressure SHALL raise the
value; `2048` restores ~65% occupancy.

The lowered default depends on the event store being byte-bounded. Enforcing
that pairing requires `maxTotalEventBytes`, which does not exist until
`bound-event-store-by-bytes` merges, so the enforcing invariant ships in
`guard-server-heap-and-store-coupling`. Until then the pairing is a release
ordering constraint, not a mechanism.

#### Scenario: Defaults apply when the config omits the blocks
- **WHEN** the config file contains neither `sessionHeap` nor `serverHeap`
- **THEN** a spawned pi session SHALL be started with a `512` MB old-space request
- **AND** the dashboard server SHALL be started with a `1536` MB old-space request

#### Scenario: Operator lowers the session ceiling
- **WHEN** the config sets `sessionHeap.maxOldSpaceMb` to `512`
- **THEN** a subsequently spawned pi session SHALL be started with a `512` MB old-space request
- **AND** the dashboard server's own ceiling SHALL be unaffected

#### Scenario: Optional young-generation and initial-size fields
- **WHEN** the config sets `sessionHeap.initialOldSpaceMb` and `sessionHeap.maxSemiSpaceMb`
- **THEN** the spawned pi session SHALL be started with the corresponding V8 sizing requests
- **AND** omitting either field SHALL leave that V8 default untouched

### Requirement: The dashboard server SHALL report its own heap and GC telemetry

The server process is the one being bounded, and the accepted occupancy relies
on pressure being observable before it becomes an OOM. `/api/health` today
reports only `rss`, `heapUsed` and `heapTotal` for the server. It SHALL also
report the server's `heapSizeLimit`, a major-GC count, and the **effective**
ceiling the running process was started with.

#### Scenario: Server health exposes heap ceiling and GC pressure
- **WHEN** `/api/health` is requested
- **THEN** the server block SHALL carry the server process's `heapSizeLimit` and a major-GC count
- **AND** it SHALL carry the effective old-space ceiling the process was started with

#### Scenario: Effective ceiling reflects the running process, not the config
- **WHEN** the configured ceiling has been changed but the process has not been cold-started
- **THEN** the reported effective ceiling SHALL remain the value the running process was started with

### Requirement: Invalid heap configuration falls back to the default

A heap field that is absent, non-numeric, non-integer, or below the supported
floor SHALL fall back to its default at config-load time, consistent with the
existing configuration convention. Loading SHALL NOT fail and the dashboard
SHALL NOT start a process with an invalid sizing request.

The supported floor for `maxOldSpaceMb` SHALL be `64`. Below that, V8's fixed
overhead dominates the requested size and the request stops being meaningful.

#### Scenario: Below-floor value is rejected in favor of the default
- **WHEN** the config sets `sessionHeap.maxOldSpaceMb` to `16`
- **THEN** the loaded configuration SHALL report `512`
- **AND** the spawned session SHALL be started with the `512` MB request

#### Scenario: Non-numeric value is rejected in favor of the default
- **WHEN** the config sets `sessionHeap.maxOldSpaceMb` to `"lots"`
- **THEN** the loaded configuration SHALL report `512`
- **AND** config loading SHALL succeed

#### Scenario: Configured values are validated before reaching a process argument
- **WHEN** a heap value survives config load
- **THEN** it SHALL be a positive integer before it is placed into any spawned process's argument list or command string

### Requirement: The session heap limit travels as a process argument

The session heap limit SHALL be applied to the spawned pi process as a Node
runtime argument rather than through the `NODE_OPTIONS` environment variable, on
every spawn mechanism the dashboard supports.

This is required, not stylistic: `NODE_OPTIONS` refuses `--initial-old-space-size`
outright, and any value placed in `NODE_OPTIONS` is inherited by every Node
process the session subsequently starts — build, test, and tooling
subprocesses — which SHALL NOT be constrained by the session's ceiling.

Terminal-multiplexer strategies are the exception. Their pane environment comes
from a long-lived multiplexer server and their pi invocation must resolve inside
the pane's own namespace, so the limit SHALL instead be delivered through the
multiplexer's per-window environment facility, carrying only the subset
`NODE_OPTIONS` accepts. On those strategies the ceiling is inherited by
processes started inside the pane; this is accepted as the cost of reaching the
pane at all.

Where a mechanism offers neither an argument position nor a per-window
environment, the limit MAY ride the child environment with the accepted subset.
The fallback SHALL be recorded in two places: a line in the server log, and a
field on the health endpoint, so it is discoverable both post-mortem and live.
That fallback SHALL NOT be used on the headless strategy, where an
environment-borne limit would also bind the supervising process.

#### Scenario: Session process runs under the configured ceiling
- **WHEN** a pi session is spawned with `sessionHeap.maxOldSpaceMb` set to `512`
- **THEN** that process's reported V8 heap ceiling SHALL be at least the requested `512` MB and no more than `300` MB above it
- **AND** it SHALL NOT reflect the dashboard server's ceiling

> The upper tolerance exists because V8 adds a fixed overhead to the request
> (observed ~192 MB) whose exact size is runtime-version-dependent. An
> exact-equality expectation would fail on a runtime upgrade that is not a
> behavioral regression.

#### Scenario: Tooling started by the session is not capped
- **WHEN** a spawned pi session starts a Node subprocess, such as a test runner or a build
- **THEN** that subprocess SHALL NOT inherit the session's heap ceiling through the environment

#### Scenario: Multiplexer strategy delivers the ceiling per window
- **WHEN** a session is spawned into a multiplexer pane
- **THEN** the ceiling SHALL be delivered through the multiplexer's per-window environment facility
- **AND** it SHALL apply even when the multiplexer server was started before the ceiling was configured

#### Scenario: Fallback is recorded rather than silent
- **WHEN** a mechanism offers neither an argument position nor a per-window environment
- **THEN** the ceiling SHALL be applied via the accepted `NODE_OPTIONS` subset
- **AND** a line recording the fallback SHALL appear in the server log
- **AND** the health endpoint SHALL expose that the fallback is in use

### Requirement: The ceiling and the subagent fan-out bound SHALL be presented as coupled

`Agent` children execute inside the parent session's process, so they share one
V8 heap and one ceiling. A per-child budget is therefore not expressible; the
only lever over subagent memory is `maxConcurrentSubagents`, which silently
becomes a memory-safety setting once a ceiling is enforced.

The operator SHALL be warned when the configured pair leaves each concurrent
child less than approximately `100` MB, computed as
`maxOldSpaceMb / (maxConcurrentSubagents + 1)` — the `+ 1` accounting for the
parent itself. The warning SHALL NOT block the save: both values remain valid,
and the pairing is a risk to disclose rather than an error.

#### Scenario: A risky pairing is disclosed
- **WHEN** the session ceiling is `512` and `maxConcurrentSubagents` is raised to `8`
- **THEN** the operator SHALL be warned that each concurrent child is left under the guidance figure
- **AND** the save SHALL still be permitted

#### Scenario: The shipped pairing is not warned
- **WHEN** the session ceiling is `512` and `maxConcurrentSubagents` is the default `2`
- **THEN** no warning SHALL be shown

#### Scenario: No fallback is reported on the normal path
- **WHEN** every session was spawned through an argument position or a per-window environment
- **THEN** the health endpoint SHALL NOT report the fallback as in use

### Requirement: An inherited dashboard heap flag is not propagated to sessions

The dashboard server runs with its own heap flag in its environment. That flag
SHALL NOT be passed on to spawned pi sessions, so it cannot reach the session's
own subprocesses.

A heap flag the operator pinned in the environment themselves SHALL continue to
be honored and SHALL NOT be stripped. Presence of a heap flag alone SHALL NOT be
treated as evidence of operator intent, because the dashboard stamps that same
flag into its own environment on every launch path — including across a restart
that inherits the environment of the process being replaced.

#### Scenario: Server's own flag does not reach the session environment
- **WHEN** the dashboard server is running with its heap flag in `NODE_OPTIONS` and spawns a pi session
- **THEN** the spawned session's `NODE_OPTIONS` SHALL NOT contain the dashboard's heap flag

#### Scenario: Operator-pinned flag is preserved
- **WHEN** the operator started the dashboard with a heap flag they set themselves
- **THEN** that flag SHALL be preserved rather than stripped
- **AND** the configured session ceiling SHALL still govern the spawned session process

#### Scenario: Restart does not turn a dashboard flag into an operator flag
- **WHEN** the server is restarted through the restart endpoint, inheriting the previous process's environment
- **THEN** the dashboard's own heap flag SHALL NOT be reclassified as operator-pinned

#### Scenario: Multiplexer strategies are exempt from the withholding rule
- **WHEN** a session is spawned into a multiplexer pane
- **THEN** a heap flag MAY be present in that pane's environment because it is the delivery mechanism for the ceiling on that strategy
- **AND** the value present SHALL be the configured ceiling, never the dashboard's own

### Requirement: Heap configuration applies to newly started processes only

Changing heap configuration SHALL NOT resize any running process. A new value
SHALL take effect for processes started after the change.

The boundary SHALL be the next spawn. Reloading a session counts as a spawn: it
replaces the process and rebuilds the invocation from current configuration.

A change to `serverHeap` SHALL NOT take effect on an in-place server restart
that inherits the current environment; it SHALL take effect on a cold start.

#### Scenario: Running sessions are unaffected by a config change
- **WHEN** the operator lowers `sessionHeap.maxOldSpaceMb` while sessions are running
- **THEN** every running session SHALL keep its original ceiling

#### Scenario: A reload after the change adopts the new value
- **WHEN** the operator lowers the ceiling and then reloads a running session
- **THEN** the replacement process SHALL run under the new ceiling

#### Scenario: Server ceiling changes only on cold start
- **WHEN** the operator changes `serverHeap.maxOldSpaceMb` and triggers an in-place restart
- **THEN** the restarted server SHALL retain the previous ceiling
- **AND** the surface offering the setting SHALL state that a cold start is required
