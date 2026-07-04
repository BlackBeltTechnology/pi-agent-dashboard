## MODIFIED Requirements

### Requirement: KB reindex route

The dashboard server SHALL expose `POST /api/kb/reindex?cwd=<abs>` that starts a reindex of the folder's resolved sources via the shared `indexSource` primitive, without requiring a live pi session, and SHALL respond as soon as the job is registered (non-blocking) rather than after the walk completes.

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

### Requirement: KB row reflects index state

The KB folder row SHALL derive its presentation from the folder's KB stats and from the outcome of any client-initiated reindex, distinguishing not-indexed, indexing, populated, stale, and error states. A reindex that fails to complete — whether the server job errored or the client request itself was rejected — SHALL surface a visible failed state, never a silent no-op.

#### Scenario: Empty worktree prompts indexing
- **WHEN** folder `W` reports `indexed: false`
- **THEN** the row shows a not-indexed label and a prominent `Index now` action

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
- **WHEN** the user activates `Index now` for folder `C` and the `POST /api/kb/reindex?cwd=C` request itself is rejected (for example `403`, `500`, or a transport failure) so no server job is registered
- **THEN** the row shows a visible failed state carrying the reject reason with a `Retry` action
- **AND** the failed state is driven by the trigger rejection specifically, distinct from a transient stats-poll failure
- **AND** activating `Retry` re-issues the reindex for `C`
