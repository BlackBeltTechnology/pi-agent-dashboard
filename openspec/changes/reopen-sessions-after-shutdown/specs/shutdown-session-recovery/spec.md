## ADDED Requirements

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

When a session is closed intentionally — manual close (`handleShutdown`), force-kill (`handleForceKill`), or a clean server `stop()` tearing the session down — the server SHALL persist `{ live: false }` to the session's `.meta.json`. Manual close and force-kill SHALL additionally persist `closedReason: "manual"`.

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

On server cold start, for each rediscovered session, the server SHALL classify it as a recovery candidate WHEN its `.meta.json` carries `live: true` AND does NOT carry `closedReason: "manual"`. All other sessions SHALL NOT be candidates.

#### Scenario: Interrupted session is a candidate

- **GIVEN** a `.meta.json` with `live: true` and no `closedReason`
- **WHEN** the server classifies sessions on cold start
- **THEN** the session SHALL be a recovery candidate

#### Scenario: Cleanly closed session is not a candidate

- **GIVEN** a `.meta.json` with `live: false` (with or without `closedReason: "manual"`)
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

On cold start with at least one recovery candidate, the server's behavior SHALL be governed by the `reopenSessionsAfterShutdown` setting: `off` (classify but take no further action), `ask` (broadcast a single recovery offer to all connected clients), or `auto` (resume all candidates without prompting). The default SHALL be `ask`.

#### Scenario: Ask mode broadcasts one offer

- **GIVEN** setting `reopenSessionsAfterShutdown = "ask"` and N ≥ 1 candidates
- **WHEN** the server completes cold-start classification
- **THEN** it SHALL broadcast exactly one recovery offer listing the N candidates to all connected clients

#### Scenario: Off mode takes no action

- **GIVEN** setting `reopenSessionsAfterShutdown = "off"`
- **WHEN** cold-start classification finds candidates
- **THEN** the server SHALL NOT broadcast a recovery offer and SHALL NOT auto-resume

#### Scenario: Auto mode resumes without prompting

- **GIVEN** setting `reopenSessionsAfterShutdown = "auto"` and N ≥ 1 candidates
- **WHEN** the server completes cold-start classification
- **THEN** it SHALL resume each candidate via the existing resume flow
- **AND** SHALL NOT broadcast a recovery prompt

#### Scenario: No candidates yields no offer

- **GIVEN** zero recovery candidates on cold start
- **WHEN** classification completes (in any setting mode)
- **THEN** the server SHALL NOT broadcast a recovery offer

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
- **THEN** the classification result SHALL depend only on per-session `.meta.json` `live` / `closedReason` fields
- **AND** SHALL NOT change based on the home-lock file or its metadata
