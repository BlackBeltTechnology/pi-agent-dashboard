# kb-folder-slot Specification

## Purpose
TBD - created by archiving change add-kb-folder-slot. Update Purpose after archive.
## Requirements
### Requirement: KB stats route

The dashboard server SHALL expose `GET /api/kb/stats?cwd=<abs>` returning the knowledge-base entry counts for that folder's resolved KB store.

#### Scenario: Populated folder returns counts
- **WHEN** `GET /api/kb/stats?cwd=C` is called and folder `C`'s KB db has entries
- **THEN** the response is `200` with `{ files, chunks, indexed: true, staleCount, indexing, jobStatus, lastError }`
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

### Requirement: KB folder nav slot

The folder group SHALL render a `KB` row via a `sidebar-folder-section` claim, as a sibling of the `Goals` and `Automations` folder sections, showing the entry count and a reindex affordance.

#### Scenario: Populated folder shows chunk count
- **WHEN** folder `C` has `N` chunks indexed
- **THEN** the row shows `KB · N chunks`
- **AND** a reindex control is present

#### Scenario: Count tooltip includes files
- **WHEN** the user hovers the KB count for folder `C` with `F` files and `N` chunks
- **THEN** the tooltip shows `F files · N chunks`

#### Scenario: Reindex control triggers a reindex
- **WHEN** the user activates the reindex control for folder `C`
- **THEN** the client calls `POST /api/kb/reindex?cwd=C`
- **AND** the row reflects the updated count when the job completes

### Requirement: KB row on worktree session cards

A worktree session groups under its `gitWorktree.mainPath` in the sidebar and therefore never renders its own folder card. To keep a worktree's KB reachable, the session card SHALL render the KB row for worktree sessions via a `worktree-card-section` claim, scoped to the worktree's OWN `cwd` (not the parent repo it collapses under). The KB plugin SHALL claim `worktree-card-section` with the same `FolderKbSection` component used by `sidebar-folder-section`.

#### Scenario: Worktree session card shows its own KB row
- **WHEN** a session card renders for a session whose `gitWorktree` is set, with cwd `W`
- **THEN** the card renders the KB row scoped to `W`
- **AND** the row reflects `W`'s KB stats (not the parent repo's), e.g. `KB · not indexed` + `Index now` for an unindexed worktree

#### Scenario: Non-worktree session card omits the KB row
- **WHEN** a session card renders for a session whose `gitWorktree` is unset
- **THEN** the card does NOT render the `worktree-card-section` KB row (the folder-scoped row lives on the sidebar folder card instead)

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

### Requirement: KB config read route

The dashboard server SHALL expose `GET /api/kb/config?cwd=<abs>` returning the folder's resolved KB config and its origin.

#### Scenario: Read project config
- **WHEN** `GET /api/kb/config?cwd=C` is called and folder `C` has a `.pi/dashboard/knowledge_base.json`
- **THEN** the response is `200` with `{ config, origin: "project", projectPath }`
- **AND** `config.sources` reflects the project file

#### Scenario: Read reports fallback origin
- **WHEN** `GET /api/kb/config?cwd=W` is called for a folder with no project file
- **THEN** the response reports `origin` as `"global"` or `"defaults"`
- **AND** the client can present a create/copy affordance

#### Scenario: Unknown cwd is rejected
- **WHEN** `GET /api/kb/config?cwd=X` is called with a cwd not matching any known folder descriptor
- **THEN** the request is rejected

### Requirement: KB config write route

The dashboard server SHALL expose `PUT /api/kb/config?cwd=<abs>` that validates and writes the folder's project `knowledge_base.json`, editing the path fields (`sources`, `include`, `exclude`, `dbPath`) while preserving other config fields.

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

### Requirement: KB source management UI

The per-folder KB settings page (opened from the folder row's `→`) SHALL let the user manage the indexed paths for that folder.

#### Scenario: List current sources
- **WHEN** the KB settings page for folder `C` opens
- **THEN** it lists each `source` (ref, priority) plus the `include`/`exclude` globs and `dbPath`
- **AND** it shows the config `origin` and live entry count

#### Scenario: Add and save a source
- **WHEN** the user adds a source path and activates `Save + Reindex`
- **THEN** the client calls `PUT /api/kb/config?cwd=C` with the updated `sources`
- **AND** a reindex is triggered so the new path is indexed

#### Scenario: Worktree bootstrap affordances
- **WHEN** the settings page for a folder with no project file opens
- **THEN** it offers `Create project config` and `Copy from parent repo`
- **AND** `Copy from parent repo` seeds `sources[]` from the parent, rewritten relative to the folder cwd

