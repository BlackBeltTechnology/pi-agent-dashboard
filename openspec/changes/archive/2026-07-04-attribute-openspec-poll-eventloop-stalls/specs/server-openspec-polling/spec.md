## ADDED Requirements

### Requirement: The poll path self-attributes its per-turn synchronous cost

The server SHALL time the synchronous run of each instrumented event-loop turn on
the OpenSpec poll path with a monotonic clock and, when a turn's own synchronous
run exceeds a configured floor, self-record an observation (timestamp, duration,
turn label) into the event-loop stall buffer defined in `server-session-hydration`.
Attribution SHALL be per single synchronous turn, NEVER a sum across turns,
because the tick's synchronous work is spread across many turns: the `setInterval`
turn (`tickOpen`: the folder-head git-HEAD poll `tickFolderHeads`,
`reconcileWatchers`, `computeKnownDirectories`) and, per directory, two turns
split by the worker `await` — `dirPollPre` (root and list-signal `stat`s before
the worker call) and `dirPollPost` (worker-response deserialization and the
broadcast after it resolves). The per-change TOCTOU mtime stamping runs inside the
worker and is NOT a main-thread turn.

#### Scenario: A synthetic single-turn block is self-attributed
- **WHEN** an instrumented turn's own synchronous run exceeds the floor
- **THEN** the server SHALL self-record an observation labelled with that turn

#### Scenario: Work split by an await is not counted as one turn
- **GIVEN** synchronous work runs both before and after the worker `await` in a directory's poll callback
- **WHEN** the per-turn timing is applied
- **THEN** the pre-await and post-await runs SHALL be timed as separate turns (`dirPollPre`, `dirPollPost`), not summed across the await

### Requirement: Per-turn main-thread work does not block the event loop

The server SHALL NOT allow any single instrumented turn's synchronous main-thread
work — `tickOpen`, `dirPollPre`, or `dirPollPost` — to block the main event loop
for a duration that stalls WebSocket frame delivery to connected clients. Such
work SHALL either run off the main thread, be gated so it performs no synchronous
filesystem or child-process work when its inputs are unchanged, or yield to the
event loop (bounded-concurrency async I/O or chunking) so no single turn produces
one uninterrupted synchronous burst.

The folder-head poll SHALL, whichever remedy is applied, continue to surface a
directory's updated git HEAD on the next tick after its ref state advances; a
remedy MUST NOT suppress a branch switch. Remedies that reorder per-directory
`git_head_update` relative to `openspec_update` MUST either preserve per-cwd
ordering or be confirmed client-tolerant.

#### Scenario: A no-op tick produces no per-turn stall
- **GIVEN** no pinned or active-session directory has changed git HEAD, openspec artifacts, or membership since the previous tick
- **WHEN** a periodic poll tick runs
- **THEN** no instrumented turn of that tick SHALL self-record a synchronous duration above the configured floor

#### Scenario: Branch switch still reflects on the next tick
- **WHEN** a directory's git HEAD advances between ticks
- **THEN** the folder-head poll SHALL re-read that directory's HEAD and surface the updated head on the next tick

### Requirement: Per-turn slow-tick warning added alongside the wall-duration warning

The server SHALL retain the existing wall-clock `durationMs` tick warning (it
still catches a genuinely overdue tick driven by slow worker or spawn work) and
SHALL ADD an independent warning that fires when any single instrumented turn's
synchronous main-thread time exceeds a configurable threshold. The per-turn
warning SHALL key on a single turn's synchronous time, NOT on a sum across turns:
because turns are spread by the intentional jitter stagger (`jitterSeconds`), a
summed signal would false-alarm on benign ticks, and a wall-duration signal is
blind to sub-second single-turn stalls. The per-turn warning SHALL name the
offending turn.

#### Scenario: Jitter-only tick does not warn on the per-turn signal
- **GIVEN** a tick whose wall `durationMs` is near `jitterSeconds` but whose work is spread across turns with no single heavy turn
- **WHEN** the tick completes
- **THEN** the server SHALL NOT emit the per-turn slow-tick warning

#### Scenario: A sub-second single-turn stall warns
- **WHEN** a single event-loop turn's synchronous time exceeds the configured threshold
- **THEN** the server SHALL emit the per-turn slow-tick warning identifying that turn

#### Scenario: An overdue tick still warns on wall duration
- **WHEN** a tick's wall `durationMs` exceeds the retained wall threshold
- **THEN** the server SHALL still emit the wall-duration slow-tick warning
