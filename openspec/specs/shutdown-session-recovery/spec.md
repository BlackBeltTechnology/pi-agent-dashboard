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

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery candidate WHEN its `.meta.json` carries `live: true` AND its persisted `status` is NOT `"ended"` AND it does NOT carry `closedReason: "manual"` AND it is NOT an automation run session (`kind: "automation"`). All other sessions SHALL NOT be candidates.

Automation run sessions are fully exempt: respawning a headless rpc run detached from its automation (no per-fire context, no run finalization) would recreate the zombie-session class that `fix-automation-stop-zombie-runs` terminates. They normalize to `ended` like any non-candidate.

Both durable signals are required because neither alone is sufficient. A clean close runs `unregister()`, which sets and persists `status: "ended"` — this covers BOTH a dashboard close and a pi TUI quit, so the `status !== "ended"` condition excludes every clean unregister. A crash never reaches `unregister()`, so the sidecar keeps its last running status. A clean server `stop()` (idle timer / app quit) clears `live: false` WITHOUT unregistering each session, leaving a non-`ended` status; the `live === true` condition excludes that case. Together they match EXACTLY the crash scenario.

#### Scenario: Automation run session is never a candidate

- **GIVEN** a session whose `.meta.json` carries `live: true`, a non-`ended` status, and `kind: "automation"`
- **WHEN** the server cold-starts
- **THEN** the session SHALL NOT be a recovery candidate
- **AND** its status SHALL be normalized to `ended` like any non-candidate

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

#### Scenario: Pre-feature session without marker is not a candidate

- **GIVEN** a `.meta.json` that contains no `live` field
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL NOT be a recovery candidate

### Requirement: Recovery candidates SHALL be exempt from cold-start status normalization

The existing cold-start restore logic that force-rewrites any non-`ended` session status to `ended` SHALL NOT apply to recovery candidates. Non-candidate sessions SHALL retain the existing normalization behavior unchanged.

#### Scenario: Candidate status preserved through restore

- **GIVEN** a recovery candidate restored on cold start
- **WHEN** the restore status-normalization step runs
- **THEN** the candidate's status SHALL NOT be force-rewritten to `ended`

#### Scenario: Non-candidate normalization unchanged

- **GIVEN** a restored session that is NOT a recovery candidate and has a non-`ended` status
- **WHEN** the restore status-normalization step runs
- **THEN** its status SHALL be rewritten to `ended` exactly as today

### Requirement: Server SHALL offer to reopen recovery candidates gated by a setting

On cold start with at least one recovery candidate, the server's behavior SHALL be governed by the `reopenSessionsAfterShutdown` setting: `off` (do NOT classify interrupted sessions as candidates — normalize them to `ended` like any other non-`ended` restored session, so none remain in a non-`ended` "zombie" state), `ask` (broadcast a single recovery offer to all connected clients), or `auto` (resume all candidates without prompting). The default SHALL be `ask`.

#### Scenario: Ask mode broadcasts one offer

- **GIVEN** setting `reopenSessionsAfterShutdown = "ask"` and N ≥ 1 candidates
- **WHEN** the server completes cold-start classification
- **THEN** it SHALL broadcast exactly one recovery offer listing the N candidates to all connected clients

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
- **AND** SHALL NOT broadcast a recovery prompt

#### Scenario: No candidates yields no offer

- **GIVEN** zero recovery candidates on cold start
- **WHEN** classification completes (in any setting mode)
- **THEN** the server SHALL NOT broadcast a recovery offer

### Requirement: Ask-mode prompt SHALL surface as a sticky top-right notification

In `ask` mode the client SHALL render the recovery offer as a notification in the existing top-right notification stack (shared with dashboard toasts), NOT as a blocking modal or a full-width banner. The notification SHALL be sticky — it SHALL NOT auto-dismiss on a timer the way ordinary toasts do. It SHALL offer a single primary action to reopen the candidates and a non-destructive dismiss. Dismissing SHALL NOT delete or alter the sessions on disk.

#### Scenario: Offer renders in the top-right notification stack

- **GIVEN** an `ask`-mode recovery offer is received by a client
- **WHEN** the client renders it
- **THEN** it SHALL appear in the top-right notification stack alongside any other notifications
- **AND** SHALL NOT block interaction with the dashboard beneath it

#### Scenario: Offer does not auto-time-out

- **GIVEN** a rendered recovery offer notification
- **WHEN** time passes with no user action
- **THEN** the notification SHALL remain visible (no auto-dismiss timer)

#### Scenario: Resuming any session clears the offer

- **GIVEN** a rendered recovery offer notification that the user has not acted on
- **WHEN** the user opens or resumes any session
- **THEN** the client SHALL dismiss the recovery offer notification

#### Scenario: Offer shown once per dirty boot

- **GIVEN** a recovery offer was dismissed (explicitly or by resuming a session)
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

