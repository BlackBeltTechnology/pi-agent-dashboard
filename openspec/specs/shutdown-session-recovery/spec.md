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

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery candidate WHEN its `.meta.json` carries `live: true` AND its persisted `status` is NOT `"ended"` AND it does NOT carry `closedReason: "manual"` AND it is NOT an automation run session (`kind: "automation"`) AND **no process-carrier proves the session is still alive**. A session is proven alive by EITHER of two liveness channels, and such a session SHALL NOT be a recovery candidate (its on-disk liveness marker SHALL be consumed so a later cold boot does not re-classify it):

- **Keeper channel (synchronous):** the startup keeper reclaim (`cleanupKeeperOrphans` / `discoverExistingKeepers` + `headlessPidRegistry`) found the session's keeper AND pi process alive. This is available before the offer is broadcast.
- **Bridge channel (asynchronous):** the session's bridge re-registers with `registerReason: "reattach"` within a bounded grace window after startup (tmux / TUI / mDNS-discovery sessions have no keeper socket to probe synchronously).

Disk markers alone are insufficient because a plain server restart (`process.exit` without a clean `stop()`) leaves a still-running session `live: true` + non-`ended`, identical on disk to a crash. The liveness gate distinguishes a surviving process (restart — do NOT offer) from a genuinely lost one (crash / full reboot — offer).

#### Scenario: Keeper-alive session is not a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status
- **AND** the startup keeper reclaim found the session's keeper PID and pi PID both alive
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate
- **AND** its on-disk liveness marker SHALL be consumed (`live: false`)

#### Scenario: Reattached (still-alive) session is retracted from the offer

- **GIVEN** an `ask`-mode candidate with no keeper socket (tmux / TUI / discovery bridge)
- **WHEN** its bridge re-registers with `registerReason: "reattach"` within the grace window
- **THEN** the server SHALL drop it from the pending recovery offer
- **AND** SHALL consume its on-disk liveness marker
- **AND** a client connecting afterward SHALL NOT receive it in a replayed offer

#### Scenario: Genuinely lost session is still a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status and no `closedReason`
- **AND** no keeper reclaim found it alive AND no bridge reattaches within the grace window
- **WHEN** classification completes
- **THEN** the session SHALL be a recovery candidate and SHALL be offered (`ask`) or resumed (`auto`)

#### Scenario: Interrupted (crashed) session is a candidate

- **GIVEN** a `.meta.json` with `live: true` and a non-`ended` status (e.g. `idle`/`streaming`) and no `closedReason`
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL be a recovery candidate

#### Scenario: Cleanly stopped session is not a candidate

- **GIVEN** a `.meta.json` with `live: false` (idle timer / app-quit clean stop), regardless of status
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Cleanly unregistered session (dashboard close or pi TUI quit) is not a candidate

- **GIVEN** a `.meta.json` whose persisted `status` is `"ended"` (a clean `unregister()` ran), even if `live: true` remains set
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Manual close is not a candidate

- **GIVEN** a `.meta.json` carrying `closedReason: "manual"`
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

#### Scenario: Automation run session is never a candidate

- **GIVEN** a session whose `.meta.json` carries `live: true`, a non-`ended` status, and `kind: "automation"`
- **WHEN** the server cold-starts
- **THEN** the session SHALL NOT be a recovery candidate
- **AND** its status SHALL be normalized to `ended` like any non-candidate

#### Scenario: Pre-feature session without marker is not a candidate

- **GIVEN** a `.meta.json` that contains no `live` field
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

### Requirement: Reopen SHALL be non-actionable while a candidate's liveness is unresolved

Because the bridge (Class-2) liveness channel resolves asynchronously, the `ask`-mode offer is broadcast immediately but a candidate's liveness may stay unresolved for a bounded grace window. During that window the offer SHALL be shown but Reopen SHALL NOT be actionable, so a still-alive session whose bridge is about to reattach cannot be reopened — reopening it would spawn a second pi for one sessionId and break message routing (the gateway session→connection map is last-write-wins). The offer message SHALL carry the grace deadline so a client (including one that connects mid-window) renders a non-actionable "verifying" state until it passes. The server SHALL additionally refuse a `continue` resume for a candidate whose liveness is still unresolved, closing the race for non-UI clients.

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

