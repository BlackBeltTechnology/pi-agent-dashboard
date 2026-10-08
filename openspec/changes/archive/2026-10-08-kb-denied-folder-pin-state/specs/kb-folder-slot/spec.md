## MODIFIED Requirements

### Requirement: KB stats route

The dashboard server SHALL expose `GET /api/kb/stats?cwd=<abs>` returning the knowledge-base entry counts for that folder's resolved KB store, whether the folder exists, and how many sources it configures. The stats route SHALL be side-effect free: it SHALL NOT create the folder, any directory beneath it, or an index database.

#### Scenario: Populated folder returns counts
- **WHEN** `GET /api/kb/stats?cwd=C` is called and folder `C`'s KB db has entries
- **THEN** the response is `200` with `{ files, chunks, indexed: true, staleCount, indexing, jobStatus, lastError, folderMissing: false, sourceCount }`
- **AND** `chunks` equals `store.counts().chunks` for `C`'s resolved `dbAbsPath`

#### Scenario: Stats surface the last job error
- **WHEN** `GET /api/kb/stats?cwd=C` is called after the last reindex job for `C` failed
- **THEN** the response reports `jobStatus: "error"` with a `lastError` string
- **AND** the client can distinguish this failed state from a never-indexed folder (`chunks: 0`, `jobStatus: "idle"`)

#### Scenario: Un-indexed folder reports empty
- **WHEN** `GET /api/kb/stats?cwd=W` is called for a worktree `W` whose KB db is absent or empty
- **THEN** the response is `200` with `chunks: 0` and `indexed: false`

#### Scenario: Unknown cwd is rejected
- **WHEN** `GET /api/kb/stats?cwd=X` is called with a cwd not matching any known folder descriptor
- **THEN** the request is rejected (no store is opened for an arbitrary path)

#### Scenario: Stats never materialize a folder
- **WHEN** `GET /api/kb/stats?cwd=C` is called for an admitted folder `C` whose KB db file does not exist
- **THEN** the response is `200` with `chunks: 0` and `indexed: false`
- **AND** no file or directory is created under `C` (in particular no `.pi/dashboard/kb/index.db`)

#### Scenario: Removed folder reports missing
- **WHEN** `GET /api/kb/stats?cwd=C` is called for an admitted folder `C` (for example a session cwd of a removed worktree) that no longer exists as a directory
- **THEN** the response is `200` with `folderMissing: true`, `chunks: 0`, `sourceCount: 0`, `staleCount: 0`
- **AND** `C` is not created

#### Scenario: Stats report configured source count
- **WHEN** `GET /api/kb/stats?cwd=C` is called for an existing folder whose resolved KB config lists `N` source specs (`N` may be `0` when no project, global, or legacy config defines any)
- **THEN** the response carries `sourceCount: N`

### Requirement: KB reindex route

The dashboard server SHALL expose `POST /api/kb/reindex?cwd=<abs>` that starts a reindex of the folder's resolved sources via the shared `indexSource` primitive, without requiring a live pi session, and SHALL respond as soon as the job is registered (non-blocking) rather than after the walk completes. Before registering a job the route SHALL refuse, without creating anything, a folder that no longer exists (`409 { error: "folder missing" }`) and a folder whose resolved config has zero source specs (`409 { error: "no sources configured" }`).

#### Scenario: Reindex starts non-blocking and completes in-process
- **WHEN** `POST /api/kb/reindex?cwd=W` is called for a worktree with no attached pi session and no reindex currently running
- **THEN** the route registers the job and responds `202` with `{ status: "running", jobId }` without waiting for the walk to finish
- **AND** `indexSource` continues running over `W`'s resolved sources in the dashboard-server process
- **AND** while the walk runs `GET /api/kb/stats?cwd=W` reports `indexing: true`
- **AND** on completion `GET /api/kb/stats?cwd=W` reports `indexing: false`, `chunks > 0`, and `indexed: true`

#### Scenario: The walk does not block concurrent stats reads
- **WHEN** a reindex of a large folder (more files than one commit batch) is in progress
- **THEN** concurrent `GET /api/kb/stats?cwd=` requests are served successfully (never a database-locked error) throughout the walk
- **AND** at least one such read observes `indexing: true` before the walk settles
- **AND** the committed chunk count is observable as it climbs during the walk

#### Scenario: Concurrent reindex is coalesced
- **WHEN** a reindex job for cwd `C` is already running and a second `POST /api/kb/reindex?cwd=C` arrives
- **THEN** no second walk is started
- **AND** the response references the in-flight job (`202` with `status: "running"`)

#### Scenario: Reindex is incremental
- **WHEN** a reindex runs for cwd `C` and no file under `C` changed since the last index
- **THEN** the mtime→sha256 gate skips unchanged files
- **AND** a subsequent `GET /api/kb/stats?cwd=C` reflects no new chunks for unchanged files

#### Scenario: Failure surfaces an error without blocking the response
- **WHEN** the reindex walk for cwd `C` throws after the job has been registered
- **THEN** the route has already responded `202` (the job started)
- **AND** a subsequent `GET /api/kb/stats?cwd=C` reports the folder as not currently indexing (`indexing: false`) with `jobStatus: "error"` and the `lastError`

#### Scenario: Missing folder is refused without materializing it
- **WHEN** `POST /api/kb/reindex?cwd=C` is called for an admitted folder `C` that does not exist as a directory
- **THEN** the response is `409` with `{ error: "folder missing" }`
- **AND** no job is registered and nothing is created under `C`

#### Scenario: Preflight runs after coalescing
- **WHEN** a reindex job for `C` is already running and `C` is then removed, and a second `POST /api/kb/reindex?cwd=C` arrives
- **THEN** the response is `202` referencing the in-flight job, not `409`

#### Scenario: Folder removed after the job was accepted
- **WHEN** `C` is removed after `POST /api/kb/reindex?cwd=C` returned `202` but before the walk opens the index
- **THEN** the job settles with `jobStatus: "error"` and `lastError: "folder missing"`
- **AND** nothing is created under `C`

#### Scenario: Zero sources is refused instead of a silent no-op
- **WHEN** `POST /api/kb/reindex?cwd=C` is called for an existing folder whose resolved config has zero source specs
- **THEN** the response is `409` with `{ error: "no sources configured" }`
- **AND** no job is registered and no index database is created

#### Scenario: Same preconditions for the browser action path
- **WHEN** a `plugin_action` reindex for `kb` arrives for an admitted folder that is missing or has zero source specs
- **THEN** no job is started and nothing is created (the refusal is logged)

### Requirement: KB config write route

The dashboard server SHALL expose `PUT /api/kb/config?cwd=<abs>` that validates and writes the folder's project `knowledge_base.json`, editing the path fields (`sources`, `include`, `exclude`, `dbPath`) while preserving other config fields. The route SHALL refuse a folder that no longer exists as a directory with `409 { error: "folder missing" }` and SHALL NOT create it.

#### Scenario: Valid write persists project config
- **WHEN** `PUT /api/kb/config?cwd=C` is called with a valid `sources`/`include`/`exclude`
- **THEN** `validateConfig` passes
- **AND** `.pi/dashboard/knowledge_base.json` is written atomically for `C`
- **AND** a subsequent `GET /api/kb/config?cwd=C` reports `origin: "project"` with the new values

#### Scenario: Invalid config is not written
- **WHEN** `PUT /api/kb/config?cwd=C` is called with an invalid source (missing `ref` or unknown `kind`)
- **THEN** `validateConfig` fails and the response is `400` with an `error`
- **AND** no file is written

#### Scenario: Untouched fields are preserved
- **WHEN** `PUT /api/kb/config?cwd=C` edits only `sources` on a folder whose project file has custom `ranking`
- **THEN** the written file retains the custom `ranking`

#### Scenario: Write bootstraps a missing project file
- **WHEN** `PUT /api/kb/config?cwd=W` is called for a folder whose `origin` is `global` or `defaults`
- **THEN** a new project `knowledge_base.json` is scaffolded for `W` with the submitted path fields

#### Scenario: Config write refuses a missing folder
- **WHEN** `PUT /api/kb/config?cwd=C` (or a `plugin_action` `config.set` for `kb`) is called for an admitted folder `C` that does not exist as a directory
- **THEN** the REST response is `409` with `{ error: "folder missing" }` (the action path logs and does nothing)
- **AND** no `knowledge_base.json` and no directory are created under `C`

#### Scenario: Save-and-reindex with zero sources skips the job
- **WHEN** `PUT /api/kb/config?cwd=C` (or `config.set`) with a reindex request saves a config whose resolved source specs are empty
- **THEN** the config is written, no reindex job is registered, and the REST response carries `reindexSkipped: "no sources configured"`

### Requirement: KB row reflects index state

The KB folder row SHALL derive its presentation from the folder's KB stats and from the outcome of any client-initiated reindex, distinguishing not-indexed, no-sources, missing, indexing, populated, stale, error, and denied states. A folder with zero configured sources SHALL NOT offer an index action that cannot index anything; it SHALL offer to configure sources instead. A folder that no longer exists SHALL offer no index action. A reindex that fails to complete — whether the server job errored or the client request itself was rejected for a reason other than cwd admission — SHALL surface a visible failed state, never a silent no-op. A cwd-admission refusal (a `403` from any `/api/kb/*` request for the folder whose body carries `error: "cwd not allowed"`) SHALL surface a distinct `denied` state, never the failed state, because no index was attempted and a retry cannot succeed. Activating the primary reindex action SHALL give immediate visible feedback (an optimistic indexing indicator) on click, before the server acknowledges, and SHALL disable the action for the duration of that pending window so a single click cannot start two jobs. The optimistic indicator SHALL always resolve into a real state (polled indexing, populated, failed, or denied) and SHALL never persist indefinitely.

#### Scenario: Empty worktree prompts indexing
- **WHEN** folder `W` reports `indexed: false` and a `sourceCount` greater than `0` (or no `sourceCount`)
- **THEN** the row shows a not-indexed label and a prominent `Index now` action

#### Scenario: Click gives immediate optimistic feedback before the server acknowledges
- **WHEN** the user activates `Index now` (or the reindex control) for folder `C`
- **THEN** the row shows the indexing indicator immediately on click, before the `POST /api/kb/reindex?cwd=C` response or the first `GET /api/kb/stats?cwd=C` poll resolves
- **AND** the activated action control is disabled while this optimistic pending state is in effect, so a second activation starts no second reindex
- **AND** the optimistic indicator is presented identically to the running-job indexing indicator (no separate submitting affordance)

#### Scenario: Optimistic pending hands off to the real running job
- **WHEN** an optimistic pending indicator is showing for folder `C` and a subsequent `GET /api/kb/stats?cwd=C` poll first reports `indexing: true`
- **THEN** the row continues to show the indexing indicator without any flicker back to the `Index now` / not-indexed presentation
- **AND** the row is thereafter driven by the polled job state, updating to the populated chunk count when the job completes

#### Scenario: Optimistic pending never wedges on a fast-settling job
- **WHEN** an optimistic pending indicator is showing for folder `C` but the reindex completes so quickly that no `GET /api/kb/stats?cwd=C` poll ever observes `indexing: true`
- **THEN** the optimistic indicator clears within a bounded time rather than spinning indefinitely
- **AND** the row settles to the state derived from fresh stats (for example the populated chunk count)

#### Scenario: Running job shows progress from the primary action
- **WHEN** the user activates `Index now` (or the reindex control) for folder `C` and the server responds `202 { status: "running" }`
- **THEN** the client begins polling `GET /api/kb/stats?cwd=C`
- **AND** while the job reports `indexing: true` the row shows an indexing state with an animated indicator
- **AND** the row updates to the populated chunk count when the job completes

#### Scenario: Transient poll failure during a walk keeps the spinner
- **WHEN** a reindex for folder `C` is running (`indexing: true`) and a single `GET /api/kb/stats?cwd=C` poll fails transiently (network blip / brief 5xx)
- **THEN** the row continues to show the indexing indicator rather than flipping to a failed state
- **AND** polling continues so the client still observes the eventual terminal state (`populated` or `jobStatus: "error"`)

#### Scenario: Stale source files are flagged
- **WHEN** folder `C` has `staleCount > 0` from `dox-staleness.json`
- **THEN** the row shows the chunk count plus a `stale` flag with the stale count
- **AND** the stale count reflects drifted source files only, not markdown drift

#### Scenario: Failed server job offers retry
- **WHEN** the last reindex for folder `C` ended in error (`GET /api/kb/stats?cwd=C` reports `jobStatus: "error"`)
- **THEN** the row shows a failed state with a `Retry` action
- **AND** the failed state is distinguished from not-indexed even when `chunks` is `0`

#### Scenario: Rejected client reindex surfaces an error, not a silent no-op
- **WHEN** the user activates `Index now` for folder `C` and the `POST /api/kb/reindex?cwd=C` request itself is rejected for any reason other than a cwd-admission refusal (for example `500`, a `403` from a network/host/permission gate, or a transport failure) so no server job is registered
- **THEN** the optimistic pending indicator clears and the row shows a visible failed state carrying the reject reason with a `Retry` action
- **AND** the failed state is driven by the trigger rejection specifically, distinct from a transient stats-poll failure
- **AND** activating `Retry` re-issues the reindex for `C`

#### Scenario: Unadmitted folder shows denied, not failed
- **WHEN** `GET /api/kb/stats?cwd=C` responds `403 { error: "cwd not allowed" }` (folder `C` is neither a known session cwd nor a pinned directory nor admitted via its main checkout)
- **THEN** the row shows a neutral (non-error-colored) `not allowed` label, never `index failed`
- **AND** the row's tooltip explains, in the user's language, that the folder is not admitted and that pinning it grants access
- **AND** the row offers no `Retry` action
- **AND** the client stops polling `C` at the first `403`, without waiting for the stats-poll outage threshold

#### Scenario: Rejected reindex trigger with 403 shows denied
- **WHEN** the user activates the reindex action for folder `C` and `POST /api/kb/reindex?cwd=C` responds `403 { error: "cwd not allowed" }`
- **THEN** the optimistic pending indicator clears and the row shows the `denied` state, not the failed state

#### Scenario: Other 403s are not cwd refusals
- **WHEN** a `/api/kb/*` request for folder `C` responds `403` with any body other than `error: "cwd not allowed"` (for example `network_not_allowed`, `host_not_allowed`, `forbidden`, or a non-JSON body)
- **THEN** the row does NOT enter the `denied` state and offers no `Pin folder` action
- **AND** the failure is handled exactly as the corresponding non-`403` failure (stats-poll outage tolerance, or failed state with `Retry` for a rejected trigger)

#### Scenario: Pinning a denied folder resolves its real state
- **WHEN** the row for folder `C` is in the `denied` state, the dashboard connection is up, and the user activates `Pin folder`
- **THEN** the client requests pinning of exactly `C` through the dashboard's existing directory-pin mechanism
- **AND** the row shows a busy indicator and the action is disabled until the pin outcome is known or a bounded wait elapses
- **AND** when the dashboard reports the updated pinned-directory set including `C`, the client re-fetches `GET /api/kb/stats?cwd=C`
- **AND** once that fetch succeeds the row shows the state derived from the fresh stats (not-indexed, populated, stale, indexing, or failed) and polling semantics resume as normal

#### Scenario: Folder pinned elsewhere leaves denied
- **WHEN** the row for folder `C` is in the `denied` state and `C` is pinned through any other dashboard surface
- **THEN** the row re-fetches its stats once the updated pinned-directory set including `C` is reported, and leaves `denied` on success without a page reload

#### Scenario: Pin unavailable while disconnected
- **WHEN** the row for folder `C` is in the `denied` state and the dashboard connection is not established
- **THEN** the `Pin folder` action is rendered disabled with a perceivable offline indication in every placement, and activating it sends nothing

#### Scenario: Pin that does not admit the folder stays denied
- **WHEN** the user activates `Pin folder` for folder `C` and no updated pinned-directory set including `C` arrives within the bounded wait, or the post-pin re-fetch still responds `403 { error: "cwd not allowed" }`
- **THEN** the busy indicator clears and the row returns to the `denied` state with its `Pin folder` action enabled
- **AND** no failed state or indefinite spinner is shown

#### Scenario: Removed folder shows missing, no action
- **WHEN** `GET /api/kb/stats?cwd=C` reports `folderMissing: true`
- **THEN** the row shows a non-error `folder missing` label
- **AND** its single KB action is rendered disabled, so no reindex request is sent
- **AND** the row never shows `Index now` for `C`

#### Scenario: Zero sources offers Configure sources, not Index now
- **WHEN** `GET /api/kb/stats?cwd=C` reports `sourceCount: 0` and `chunks: 0`
- **THEN** the row shows a `no sources` label and its single KB action reads `Configure sources`
- **AND** activating it opens the folder's KB settings page and sends no reindex request

#### Scenario: Failed job on a zero-source folder never offers a dead Retry
- **WHEN** the row for `C` is in the failed state and `GET /api/kb/stats?cwd=C` reports `sourceCount: 0`
- **THEN** the row keeps its failed label but its single KB action reads `Configure sources`, not `Retry`

#### Scenario: Old server without the new fields
- **WHEN** the stats response for `C` carries neither `folderMissing` nor `sourceCount`
- **THEN** the row behaves as before this change for the non-denied states (no `missing` or `no-sources` presentation)
