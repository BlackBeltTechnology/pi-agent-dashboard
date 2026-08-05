## ADDED Requirements

### Requirement: Server SHALL maintain a durable boot record carrying exit intent

The server SHALL persist a HOME-scoped boot record at `~/.pi/dashboard/boot-state.json`,
written atomically (temp file + rename). The record SHALL carry the current boot's id
(`bootId`, equal to the server's `liveEpoch`), the recorded `exitIntent` for that boot
(initially `null`), and a bounded ring of the **8 most recent** prior boot entries so a
session's owning boot can be resolved after several consecutive boots.

`ExitIntent` SHALL be one of `"restart"`, `"shutdown"`, `"user-quit"`, `"idle"`, `"signal"`,
or `null`. `exitIntent` SHALL be write-once per boot: the first writer wins, so a later signal
during an already-announced restart cannot overwrite `"restart"`.

A failed boot-record write SHALL be logged and SHALL NOT abort startup or shutdown; an
unreadable or absent record SHALL be treated as `null` (recovery allowed).

#### Scenario: Startup stamps a fresh record

- **GIVEN** the server is starting a new boot with `liveEpoch = E`
- **WHEN** startup completes reading any prior record
- **THEN** the boot record SHALL contain `bootId: E` and `exitIntent: null`
- **AND** the prior boot's entry SHALL be retained in the ring

#### Scenario: Absent record is treated as recoverable

- **GIVEN** no `boot-state.json` exists (first launch after upgrade)
- **WHEN** the server resolves the exit intent for any session's `liveEpoch`
- **THEN** it SHALL resolve to `null`
- **AND** recovery SHALL be allowed for that session

#### Scenario: Exit intent is write-once per boot

- **GIVEN** `exitIntent` has already been recorded as `"restart"` for the current boot
- **WHEN** a SIGTERM handler subsequently attempts to record `"signal"`
- **THEN** the recorded `exitIntent` SHALL remain `"restart"`

### Requirement: Deliberate exit paths SHALL record their exit intent

Every exit path that is not a crash SHALL record its `exitIntent` into the boot record before
the process terminates:

| path | recorded intent |
|---|---|
| `POST /api/restart` | `"restart"` |
| `POST /api/shutdown` (default) | `"shutdown"` |
| `POST /api/shutdown` with a caller-declared user quit (Electron `before-quit`) | `"user-quit"` |
| idle-timer stop | `"idle"` |
| SIGTERM / SIGINT | `"signal"` |

Recovery is suppressed for exactly those intents whose exit leaves the sessions RUNNING
and instructs bridges to suppress reconnection for longer than the reattach grace window
(`"restart"`, `"shutdown"`) — such sessions reattach after any window that could retract
them, so an offer for them can never be corrected. Every other intent allows recovery and
defers to the process-liveness gate.

The server SHALL install SIGTERM and SIGINT handlers that record `"signal"`, flush pending
metadata writes, and exit. The handlers SHALL be idempotent under repeated signals.

#### Scenario: Restart records its intent before exiting

- **GIVEN** one or more sessions are running
- **WHEN** `POST /api/restart` is handled
- **THEN** the boot record SHALL carry `exitIntent: "restart"` before the process exits

#### Scenario: OS shutdown records a signal intent

- **GIVEN** the server is running in the foreground with sessions active
- **WHEN** the process receives SIGTERM
- **THEN** the boot record SHALL carry `exitIntent: "signal"`
- **AND** pending metadata writes SHALL be flushed before exit

#### Scenario: Crash records nothing

- **GIVEN** the server is running with `exitIntent: null` for the current boot
- **WHEN** the process is terminated by SIGKILL or loses power
- **THEN** the boot record SHALL still read `exitIntent: null`

### Requirement: Resume SHALL refuse a session proven alive

`resume_session` with `mode: "continue"` SHALL probe process liveness (keeper socket / pi PID,
and bridge attachment) before spawning, in addition to the existing in-memory `status` and
grace-window checks. When a carrier proves the session alive, the server SHALL refuse with
`code: "resume.already_active"` and SHALL NOT spawn a second process for that `sessionId`.

#### Scenario: Reopen of a still-live session is refused

- **GIVEN** a recovery offer that still lists a candidate whose keeper and pi process are alive
- **WHEN** the user clicks Reopen for that candidate
- **THEN** the server SHALL respond `success: false` with `code: "resume.already_active"`
- **AND** SHALL NOT spawn a second pi process for that `sessionId`

## MODIFIED Requirements

### Requirement: Cold start SHALL classify interrupted sessions as recovery candidates

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery
candidate WHEN its `.meta.json` carries `live: true` AND its persisted `status` is NOT `"ended"`
AND it does NOT carry `closedReason: "manual"` AND it is NOT an automation run session
(`kind: "automation"`) AND no process-carrier proves the session alive (keeper channel /
bridge-reattach channel) **AND the boot that owned the session did not record a
recovery-suppressing exit intent**.

Exit intent is resolved by matching the session's `liveEpoch` against the boot-record ring:

- `"restart"`, `"shutdown"` — recovery **suppressed**; the session SHALL NOT be a candidate.
- `"user-quit"`, `"idle"`, `"signal"`, `null`, or an unresolvable `liveEpoch` — recovery
  **allowed**; the remaining conjuncts (including process liveness) decide.

This closes the defect that made disk-marker absence ambiguous: `POST /api/restart` and
`POST /api/shutdown` terminate without clearing per-session markers, so a still-running session
was indistinguishable on disk from a crashed one. Recovery now depends on a **positive** record
of deliberate exit rather than on the absence of cleanup, and therefore does not depend on any
timing window for the restart path.

Because intent is recorded explicitly, a clean `stop()` SHALL NO LONGER clear the per-session
`live` markers of the sessions it tears down. Marker consumption on dismiss, liveness retract,
and offer broadcast is unchanged.

#### Scenario: Restart does not produce candidates

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "restart"`
- **WHEN** the replacement server classifies sessions on cold start
- **THEN** no session from that boot SHALL be a recovery candidate
- **AND** no recovery offer SHALL be broadcast

#### Scenario: Idle auto-stop leaves sessions recoverable

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the idle timer stopped the server, recording `exitIntent: "idle"`
- **WHEN** the server next cold starts with `reopenSessionsAfterShutdown = "ask"`
- **THEN** those sessions SHALL be recovery candidates
- **AND** a recovery offer SHALL be broadcast

#### Scenario: OS shutdown leaves sessions recoverable

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "signal"`
- **WHEN** the server next cold starts
- **THEN** those sessions SHALL be recovery candidates

#### Scenario: User quit defers to liveness

- **GIVEN** sessions running with `live: true` and non-`ended` status
- **AND** the previous boot recorded `exitIntent: "user-quit"`
- **WHEN** the server next cold starts
- **THEN** those sessions SHALL be recovery candidates
- **AND** any candidate whose keeper or bridge proves it alive SHALL be retracted before the
  offer is broadcast, so only sessions that cannot reattach are offered

#### Scenario: Two consecutive dirty boots preserve the earlier offer

- **GIVEN** boot `A` crashed with a candidate session whose `liveEpoch = A`
- **AND** boot `B` also ended with `exitIntent: null` without the offer being resolved
- **WHEN** boot `C` classifies sessions on cold start
- **THEN** the session from boot `A` SHALL still be a recovery candidate, because `A` is
  retained in the boot-record ring and resolves to a recovery-allowing intent

### Requirement: Reopen SHALL be non-actionable while a candidate's liveness is unresolved

The reattach grace window SHALL be derived from — and SHALL always exceed — the restart quiesce
window during which bridges are instructed to suppress reconnection. Both constants SHALL live
in one shared module so the relation is expressible and testable.

Previously `RECOVERY_REATTACH_GRACE_MS` (2500 ms) closed before `RESTART_QUIESCE_MS` (5000 ms)
allowed bridges to reconnect, making bridge-reattach retraction unreachable on the restart path.

In `ask` mode the recovery offer SHALL NOT be broadcast until the grace window has closed and
liveness is finalized, so a candidate that will be retracted is never rendered. The
`graceUntil` field and the "verifying" resume state SHALL be retained for clients that connect
mid-window.

#### Scenario: Grace window outlasts the quiesce window

- **GIVEN** the restart quiesce window is `Q` milliseconds
- **WHEN** the reattach grace window `G` is evaluated
- **THEN** `G` SHALL be greater than `Q`

#### Scenario: Offer is withheld until liveness resolves

- **GIVEN** `reopenSessionsAfterShutdown = "ask"` and N ≥ 1 disk-classified candidates
- **WHEN** classification completes but the grace window has not closed
- **THEN** no recovery offer SHALL be broadcast to connected clients
- **AND** once the window closes, exactly one offer SHALL be broadcast containing only the
  candidates that were not retracted

#### Scenario: Retracted candidate is never rendered

- **GIVEN** a candidate whose bridge reattaches inside the grace window
- **WHEN** the grace window closes
- **THEN** that candidate SHALL NOT appear in any broadcast offer
- **AND** its on-disk liveness marker SHALL be consumed

#### Scenario: Offer is non-actionable during the grace window

- **GIVEN** an `ask`-mode recovery offer broadcast on cold start
- **WHEN** a client renders it before the grace deadline has passed
- **THEN** the Reopen action SHALL be disabled (a "verifying" state) and Dismiss SHALL remain available
- **AND** the offer message SHALL carry the grace deadline

#### Scenario: Reopen becomes actionable once liveness is finalized

- **GIVEN** an `ask`-mode offer whose grace window has passed with no bridge reattach
- **WHEN** the client re-evaluates the offer
- **THEN** Reopen SHALL be actionable and resume the candidate on click

#### Scenario: Resume is refused while liveness is unresolved

- **GIVEN** a candidate whose liveness is still unresolved within the grace window
- **WHEN** a `resume_session` with `mode: "continue"` arrives for it
- **THEN** the server SHALL refuse it (no pi spawned) and report a resume failure
- **AND** once the window closes the same reopen SHALL succeed for a genuinely-lost candidate

