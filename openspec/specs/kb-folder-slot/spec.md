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

The folder group SHALL render a `KB` row via a `sidebar-folder-section` claim, as a sibling of the `Goals` and `Automations` folder sections, showing the entry count and its index state. The row SHALL render **no** reindex affordance of its own: reindexing is a single item in the folder actions menu's `MAINTENANCE` group.

#### Scenario: Populated folder shows chunk count
- **WHEN** folder `C` has `N` chunks indexed
- **THEN** the row shows `KB · N chunks`
- **AND** no reindex control is present in the row

#### Scenario: Count tooltip includes files
- **WHEN** the user hovers the KB count for folder `C` with `F` files and `N` chunks
- **THEN** the tooltip shows `F files · N chunks`

#### Scenario: Reindex is triggered from the menu
- **WHEN** the user activates the KB reindex item in the folder actions menu for folder `C`
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

The KB folder row SHALL derive its presentation from the folder's KB stats and from the outcome of any client-initiated reindex, distinguishing not-indexed, indexing, populated, stale, and error states. A reindex that fails to complete — whether the server job errored or the client request itself was rejected — SHALL surface a visible failed state, never a silent no-op. Activating the primary reindex action SHALL give immediate visible feedback (an optimistic indexing indicator) on click, before the server acknowledges, and SHALL disable the action for the duration of that pending window so a single click cannot start two jobs. The optimistic indicator SHALL always resolve into a real state (polled indexing, populated, or failed) and SHALL never persist indefinitely.

#### Scenario: Empty worktree prompts indexing
- **WHEN** folder `W` reports `indexed: false`
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
- **WHEN** the user activates `Index now` for folder `C` and the `POST /api/kb/reindex?cwd=C` request itself is rejected (for example `403`, `500`, or a transport failure) so no server job is registered
- **THEN** the optimistic pending indicator clears and the row shows a visible failed state carrying the reject reason with a `Retry` action
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

The per-folder KB settings page (opened from the folder row's `→`) SHALL let the user manage the indexed paths for that folder, AND SHALL offer a rebuild action that does not require editing the configuration. The rebuild action SHALL be enabled when the folder's server-resolved sources are non-empty — the same list the reindex job walks — and no rebuild or save is already in flight; it SHALL be disabled otherwise. Its enabled state SHALL NOT be gated on the config `origin` nor on whether the form has unsaved changes. The page SHALL NOT predict that a folder indexes nothing while that folder has resolvable sources.

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

#### Scenario: Rebuild an unchanged configuration
- **WHEN** the settings page for a folder with non-empty resolved sources opens and the form has NO unsaved changes
- **THEN** a `Reindex now` action SHALL be enabled
- **AND** activating it SHALL trigger `POST /api/kb/reindex?cwd=C` without first writing the config

#### Scenario: Rebuild is offered for a folder configured outside the project
- **WHEN** the settings page opens for a folder whose config `origin` is not `project` and whose resolved sources are non-empty
- **THEN** the `Reindex now` action SHALL be present and enabled alongside the bootstrap affordances
- **AND** its availability SHALL NOT depend on the presence of a project config file

#### Scenario: Rebuild tracks the saved config, not the unsaved form
- **WHEN** the form is edited so that its source list and the folder's resolved sources disagree
- **THEN** the enabled state of `Reindex now` SHALL follow the resolved sources
- **AND** a folder with empty resolved sources SHALL NOT offer an enabled `Reindex now` merely because sources were typed into the form
- **AND** a folder with non-empty resolved sources SHALL keep an enabled `Reindex now` even when the form's source list has been emptied

#### Scenario: Rebuild is refused, with a reason, when there is nothing to index
- **WHEN** the settings page opens for a folder whose resolved sources are empty
- **THEN** the `Reindex now` action SHALL be rendered in a disabled state
- **AND** an explanation that at least one indexable source must be defined first SHALL be VISIBLE beside the action without requiring hover or focus
- **AND** the action SHALL NOT be hidden

#### Scenario: The bootstrap notice does not contradict a populated index
- **WHEN** the settings page opens for a folder with no project config file but non-empty resolved sources
- **THEN** the page SHALL NOT state that the folder indexes nothing until sources are defined
- **AND** the entry count and the notice SHALL NOT assert opposite facts on the same page

#### Scenario: An empty edited source list does not predict an empty index
- **WHEN** the settings page opens for a folder whose edited `sources[]` is empty but whose resolved sources are non-empty, such as a folder configured through legacy roots
- **THEN** the page MAY report that the source list is empty
- **AND** it SHALL NOT predict that nothing will be indexed

#### Scenario: An empty source list with nothing resolvable keeps its warning
- **WHEN** the settings page opens for a folder whose edited `sources[]` is empty AND whose resolved sources are empty
- **THEN** the page SHALL still warn that nothing will be indexed

#### Scenario: Rebuild cannot be double-submitted
- **WHEN** `Reindex now` is activated
- **THEN** it SHALL be disabled for the whole window covering the optimistic pending span and any subsequently observed `indexing` state
- **AND** it SHALL re-enable once the job settles

#### Scenario: A refused rebuild trigger is surfaced in the page
- **WHEN** the `POST /api/kb/reindex` trigger is rejected so that no job starts
- **THEN** the settings page SHALL surface that error in its error region
- **AND** the action SHALL return to an enabled state so the user can retry

#### Scenario: A user-initiated failure outranks an ambient one
- **WHEN** a rebuild trigger rejection and a stats-poll outage are both outstanding
- **THEN** the error region SHALL show the rebuild trigger rejection
- **AND** a bootstrap failure, when also outstanding, SHALL outrank the rebuild trigger rejection

#### Scenario: A sustained stats outage during a rebuild is surfaced
- **WHEN** the `/api/kb/stats` poll has failed for the consecutive-miss threshold while a rebuild is in flight and the page has settled
- **THEN** the settings page SHALL surface the outage using the same channel precedence as the folder slot, where a rejected trigger outranks a poll outage
- **AND** the surfaced text SHALL NOT be silently replaced by an idle state while the outage persists

### Requirement: KB cwd admission

Every `/api/kb/*` route SHALL validate the query `cwd` against the host-provided known-folder set (live session cwds ∪ pinned directories) BEFORE opening a store or touching disk. The match SHALL be realpath-canonicalized on BOTH sides — the query `cwd` and each known folder are resolved to an absolute path and, best-effort, symlink-followed — so that two paths denoting the same directory match regardless of symlink traversal. In addition, when the direct match fails, a `cwd` that is a git worktree whose MAIN working-tree path is a known folder SHALL be admitted; the main path is derived server-side via git and never taken from client input. A `cwd` that is neither a known folder nor a git worktree of a known folder SHALL be rejected with `403`.

#### Scenario: Symlink-equivalent cwd matches a known folder
- **WHEN** `GET /api/kb/stats?cwd=A` is called where `A` reaches a known folder `K` through a symlink (for example `/tmp` for a session/pinned `/private/tmp`)
- **THEN** the canonicalized `A` equals the canonicalized `K`
- **AND** the request is admitted (not `403`)

#### Scenario: Session-less worktree of a known repo is admitted
- **WHEN** `POST /api/kb/reindex?cwd=W` (or `GET /api/kb/stats?cwd=W`) is called for a git worktree `W` that has NO live pi session and is NOT pinned, whose main repository `R` IS a known folder
- **THEN** the guard server-derives `W`'s main working-tree path via git and finds it equals a known folder `R`
- **AND** the request is admitted so `W` is indexable and its stats are readable

#### Scenario: Worktree whose main repo is not known is rejected
- **WHEN** `GET /api/kb/stats?cwd=W` is called for a git worktree `W` whose main repository is NOT a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Unknown non-worktree cwd is rejected
- **WHEN** `GET /api/kb/stats?cwd=X` is called with a cwd that is neither a known folder nor a git worktree of a known folder
- **THEN** the request is rejected with `403` and no store is opened

#### Scenario: Missing cwd is rejected
- **WHEN** any `/api/kb/*` route is called with no `cwd` query parameter
- **THEN** the request is rejected with `400`

