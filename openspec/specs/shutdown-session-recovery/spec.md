# shutdown-session-recovery Specification

## Purpose
TBD - created by archiving change reopen-sessions-after-shutdown. Update Purpose after archive.
## Requirements
### Requirement: Server SHALL stamp a durable liveness marker on running sessions

While a session is running, the server SHALL eagerly persist a liveness marker `{ live: true, liveEpoch: <server boot id> }` into that session's `.meta.json` sidecar. The write SHALL be immediate (atomic tmp+rename), NOT deferred through the debounced field-write path, so the marker survives an unclean host shutdown.

#### Scenario: Live marker stamped on session activation

- **GIVEN** a pi session transitions to running (first turn boundary after spawn or resume)
- **WHEN** the server records its activity
- **THEN** the session's `.meta.json` SHALL contain `live: true`
- **AND** SHALL contain `liveEpoch` equal to the current server boot id
- **AND** the write SHALL be performed immediately, not via the debounced write queue

#### Scenario: Live marker not rewritten every event

- **GIVEN** a session already carries `live: true` with the current `liveEpoch`
- **WHEN** subsequent turn events arrive for the same session
- **THEN** the server SHALL NOT issue a new eager liveness write for an unchanged marker

### Requirement: Intentional close SHALL clear the liveness marker with a reason

When a session is closed intentionally — manual close (`handleShutdown`), force-kill (`handleForceKill`), a clean server `stop()` tearing the session down, or ANY session unregister (explicit `session_unregister`, heartbeat expiry, run termination) — the server SHALL persist `{ live: false }` to the session's `.meta.json`. The unregister-path write SHALL be eager (atomic, not debounced): `unregister()` persists `status: "ended"` through the 1s-debounced save, and without an eager `live: false` a host death inside that window leaves `live: true` + a non-`ended` status on disk — the next cold start would offer (or in `auto` mode, silently respawn) a session that ended cleanly. Manual close and force-kill SHALL additionally persist `closedReason: "manual"`.

#### Scenario: Explicit unregister eagerly clears liveness

- **GIVEN** a running session with `live: true`
- **WHEN** the session unregisters cleanly (pi TUI quit sending `session_unregister`)
- **THEN** the session's `.meta.json` SHALL be updated to `live: false` immediately, without waiting for the debounced stats write
- **AND** SHALL NOT set `closedReason: "manual"`

#### Scenario: Manual close stamps closedReason

- **GIVEN** a running session with `live: true`
- **WHEN** the user closes it (a `shutdown` / `force_kill` message handled by the server)
- **THEN** the session's `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL contain `closedReason: "manual"`

#### Scenario: Clean server stop clears liveness without manual reason

- **GIVEN** running sessions with `live: true`
- **WHEN** the server performs a clean `stop()` (idle timer or app quit)
- **THEN** each torn-down session's `.meta.json` SHALL be updated to `live: false`
- **AND** SHALL NOT set `closedReason: "manual"`

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

### Requirement: Recovery candidates SHALL be exempt from cold-start status normalization

Recovery candidates SHALL be normalized to `ended` on cold start exactly like any other non-`ended` restored session, in ALL modes (`ask`, `auto`, `off`). No mode exempts a candidate from the force-`ended` normalization. A candidate SHALL NOT linger in a non-`ended` "reopened-looking" state before the user takes an explicit action. In `ask` mode the offer carries enough metadata (session file, cwd) to resume the candidate on explicit reopen; the resume flow re-hydrates the session independently of the pre-reopen status.

#### Scenario: Candidate normalized to ended in ask mode

- **GIVEN** setting `reopenSessionsAfterShutdown = "ask"` and a recovery candidate restored on cold start
- **WHEN** the restore status-normalization step runs
- **THEN** the candidate's status SHALL be rewritten to `ended`
- **AND** the candidate SHALL still appear in the broadcast recovery offer

#### Scenario: Non-candidate normalization unchanged

- **GIVEN** a restored session that is NOT a recovery candidate and has a non-`ended` status
- **WHEN** the restore status-normalization step runs
- **THEN** its status SHALL be rewritten to `ended` exactly as today

#### Scenario: Reopen re-hydrates a normalized candidate

- **GIVEN** an `ask`-mode candidate normalized to `ended` and listed in the offer
- **WHEN** the user clicks Reopen for that candidate
- **THEN** the server SHALL resume it via the existing resume flow using the offer's session file and cwd
- **AND** the resumed session SHALL become active regardless of its pre-reopen `ended` status

### Requirement: Server SHALL offer to reopen recovery candidates gated by a setting

On cold start with at least one recovery candidate, the server's behavior SHALL be governed by the `reopenSessionsAfterShutdown` setting: `off` (do NOT classify interrupted sessions as candidates — normalize them to `ended`, so none remain in a non-`ended` "zombie" state), `ask` (normalize candidates to `ended` AND broadcast a single recovery offer to all connected clients; reopen happens ONLY on explicit user action), or `auto` (resume all candidates without prompting and WITHOUT broadcasting any offer). The default SHALL be `ask`. In `ask` mode the server SHALL clear its held pending offer after any resolving action (reopen or dismiss) so that `onConnect` replay stops.

#### Scenario: Ask mode broadcasts one offer

- **GIVEN** setting `reopenSessionsAfterShutdown = "ask"` and N ≥ 1 candidates
- **WHEN** the server completes cold-start classification
- **THEN** it SHALL broadcast exactly one recovery offer listing the N candidates to all connected clients
- **AND** SHALL NOT resume any candidate until an explicit reopen action arrives

#### Scenario: Off mode takes no action and normalizes interrupted sessions

- **GIVEN** setting `reopenSessionsAfterShutdown = "off"`
- **AND** a session that would otherwise classify as an interrupted recovery candidate
- **WHEN** cold start runs
- **THEN** the server SHALL NOT broadcast a recovery offer and SHALL NOT auto-resume
- **AND** the session's non-`ended` status SHALL be force-normalized to `ended` (no persistent zombie state)

#### Scenario: Auto mode resumes without prompting

- **GIVEN** setting `reopenSessionsAfterShutdown = "auto"` and N ≥ 1 candidates
- **WHEN** the server completes cold-start classification
- **THEN** it SHALL resume each candidate via the existing resume flow
- **AND** SHALL NOT broadcast any recovery offer or notification

#### Scenario: No candidates yields no offer

- **GIVEN** zero recovery candidates on cold start
- **WHEN** classification completes (in any setting mode)
- **THEN** the server SHALL NOT broadcast a recovery offer

#### Scenario: Pending offer cleared after a resolving action

- **GIVEN** an `ask`-mode server holding a pending recovery offer
- **WHEN** any candidate is reopened OR the offer is dismissed
- **THEN** the server SHALL discard its held pending offer
- **AND** a client that connects afterward SHALL NOT receive a replayed recovery offer

### Requirement: Ask-mode prompt SHALL surface as a sticky top-right notification

In `ask` mode the client SHALL render the recovery offer as a notification in the existing top-right notification stack (shared with dashboard toasts), NOT as a blocking modal or a full-width banner. The notification SHALL be sticky — it SHALL NOT auto-dismiss on a timer the way ordinary toasts do. It SHALL offer a single primary action to reopen the candidates and a non-destructive dismiss. Dismissing SHALL NOT delete the session `.jsonl` on disk. Dismissing SHALL send a `recovery_dismiss` message to the server so the dismissal is durable (the server consumes the liveness marker for the offered sessions), and the offer SHALL NOT re-appear on reconnect, reload, or a later server restart.

#### Scenario: Offer renders in the top-right notification stack

- **GIVEN** an `ask`-mode recovery offer is received by a client
- **WHEN** the client renders it
- **THEN** it SHALL appear in the top-right notification stack alongside any other notifications
- **AND** SHALL NOT block interaction with the dashboard beneath it

#### Scenario: Offer does not auto-time-out

- **GIVEN** a rendered recovery offer notification
- **WHEN** time passes with no user action
- **THEN** the notification SHALL remain visible (no auto-dismiss timer)

#### Scenario: Dismiss is durable and consumes the marker

- **GIVEN** a rendered recovery offer notification
- **WHEN** the user clicks the dismiss (×) action
- **THEN** the client SHALL send a `recovery_dismiss` message listing the offered session ids
- **AND** the server SHALL clear the liveness marker for each id so those sessions are never classified as candidates again
- **AND** the offer SHALL NOT re-appear on WebSocket reconnect or page reload

#### Scenario: Dismissed sessions are not re-offered after restart

- **GIVEN** an `ask`-mode offer was dismissed and its markers consumed
- **WHEN** the server is fully restarted with no new unclean shutdown
- **THEN** cold-start classification SHALL NOT produce those sessions as candidates
- **AND** no recovery offer SHALL be broadcast for them

#### Scenario: Resuming any session clears the offer

- **GIVEN** a rendered recovery offer notification that the user has not acted on
- **WHEN** the user opens or resumes any session
- **THEN** the client SHALL dismiss the recovery offer notification

#### Scenario: Offer shown once per dirty boot

- **GIVEN** a recovery offer was resolved (reopened or dismissed)
- **WHEN** no new unclean shutdown has occurred since
- **THEN** the client SHALL NOT re-show the offer

### Requirement: Reopen SHALL reuse the existing resume flow and dedupe across devices

Reopening a recovery candidate SHALL use the existing `resume_session` flow. Concurrent reopen requests for the same session from multiple connected devices SHALL be deduplicated by the existing `pendingResumeIntents` registry such that the session is spawned at most once.

#### Scenario: Two devices reopen the same candidate

- **GIVEN** two clients each accept the reopen offer for the same candidate session
- **WHEN** both `resume_session` requests reach the server
- **THEN** `pendingResumeIntents` SHALL deduplicate them
- **AND** the underlying session SHALL be resumed at most once

### Requirement: Recovery SHALL NOT depend on the home-lock

The recovery-candidate classification SHALL be derived solely from per-session `.meta.json` liveness markers and SHALL NOT read the home-lock file or its metadata sidecar to infer whether the previous run ended cleanly.

#### Scenario: Classification ignores lock state

- **GIVEN** a cold start with any home-lock state (present, absent, stale, or freshly released)
- **WHEN** the server classifies recovery candidates
- **THEN** the classification result SHALL depend only on per-session `.meta.json` fields (`live`, `status`, `closedReason`)
- **AND** SHALL NOT change based on the home-lock file or its metadata

### Requirement: Recovery offer SHALL render with defined theme tokens so its surface and primary action are visible

The recovery offer notification SHALL bind its card background and its primary
"Reopen" action background to CSS custom properties that are declared in the active
theme. It SHALL NOT reference undeclared custom properties for these paints, because
an undeclared custom property resolves to the empty string and yields an unset
background — a transparent card or an invisible action. Specifically, the card
background SHALL use `--bg-surface` and the primary action background SHALL use
`--accent-primary` (both declared for every theme in `packages/client/src/index.css`).

#### Scenario: Offer card paints an opaque elevated surface

- **GIVEN** the recovery offer notification is rendered in any theme
- **WHEN** the client paints the offer card
- **THEN** the card background SHALL resolve to a defined theme token (`--bg-surface`)
- **AND** the card SHALL NOT be transparent

#### Scenario: Reopen action is visible

- **GIVEN** a rendered recovery offer notification
- **WHEN** the client paints the primary "Reopen" action
- **THEN** the action background SHALL resolve to a defined theme token (`--accent-primary`)
- **AND** the action SHALL be visible and clickable

#### Scenario: No undeclared custom properties on the offer

- **GIVEN** the recovery offer component source
- **WHEN** its style bindings are inspected
- **THEN** it SHALL NOT reference `--bg-elevated` or `--accent`
- **AND** every custom property it references for a background SHALL be declared in the theme

### Requirement: Auto mode SHALL NOT resume a session proven alive

In `auto` mode the server resumes candidates without prompting. The same liveness gate SHALL apply: a session proven alive by the keeper channel or the bridge-reattach channel SHALL NOT be auto-resumed, because a second `continue` spawn for a sessionId whose pi process is already alive double-registers the session and breaks message routing (the gateway session→connection map is last-write-wins).

#### Scenario: Auto mode skips a keeper-alive session

- **GIVEN** setting `reopenSessionsAfterShutdown = "auto"` and a candidate whose keeper+pi the startup reclaim found alive
- **WHEN** cold-start classification completes
- **THEN** the server SHALL NOT spawn a resume for that session
- **AND** SHALL rely on the existing keeper reattach (RPC-dispatch-ready) instead

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

