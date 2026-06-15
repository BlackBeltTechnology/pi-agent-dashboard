## Purpose

Server-side OpenSpec CLI polling per directory. The server polls each known directory (pinned dirs + session cwds) at a configurable interval and broadcasts results keyed by cwd to connected browsers, replacing the previous per-session bridge-side polling.

To avoid burst CPU usage when many active changes exist across multiple pinned directories, the scheduler layers four optimizations: a configurable interval (default 30 s), an mtime-based change-detection gate that skips re-polling unchanged proposals, a concurrency cap on CLI spawns, and a deterministic per-cwd jitter that staggers polls within each interval. All four are runtime-reconfigurable via `DashboardConfig.openspec`.
## Requirements
### Requirement: Server polls openspec CLI per directory
The server SHALL run `openspec list --json` and `openspec status --change <name> --json` for each known directory at a **configurable interval** (default 30 seconds, range 5–3600 seconds, controlled by `DashboardConfig.openspec.pollIntervalSeconds`) and broadcast results keyed by cwd to connected browsers. Each directory's poll SHALL be offset within the interval by a deterministic per-cwd phase (range 0 to `DashboardConfig.openspec.jitterSeconds`, default 5 s) so that polls do not all align on the same tick.

The set of **known directories** SHALL be the union of:
- every explicitly **pinned** directory, and
- the cwd of every session whose status is **not** `"ended"` (i.e. active sessions).

Ended sessions — including hidden ones — SHALL NOT contribute their cwd to the known-directory set. A directory whose sessions have all ended and that is not pinned SHALL stop being polled until a new session registers in it or it is pinned.

#### Scenario: Periodic poll for a known directory
- **WHEN** one poll interval has elapsed since the last poll for a directory
- **THEN** the server SHALL evaluate the directory for re-polling (subject to change detection, see below) and broadcast an `openspec_update` message with `cwd` and `data` fields if the data has changed

#### Scenario: Configurable interval
- **WHEN** `DashboardConfig.openspec.pollIntervalSeconds` is set to 60
- **THEN** the server SHALL poll every 60 seconds instead of 30
- **AND** changing this value via `PUT /api/config` SHALL take effect without a server restart

#### Scenario: Deterministic per-cwd phase offset
- **WHEN** three known directories exist and `jitterSeconds` is 5
- **THEN** each directory's poll SHALL fire at a stable offset in `[0, 5000) ms` derived from a hash of its cwd
- **AND** the same cwd SHALL receive the same offset on every tick

#### Scenario: Initial poll on server startup
- **WHEN** the server starts with known directories
- **THEN** the server SHALL poll openspec for each known directory and **after each poll completes**, broadcast `openspec_update` to all connected browsers when the prior cache was empty/undefined or the polled data differs from prior

#### Scenario: New directory becomes known
- **WHEN** a new pinned directory is added or a session registers with a new cwd
- **THEN** the server SHALL immediately poll openspec for that directory (bypassing both jitter and change detection for this first poll)

#### Scenario: Ended session cwd is excluded from polling
- **WHEN** every session in a given cwd has status `"ended"` and the cwd is not pinned
- **THEN** the server SHALL NOT include that cwd in the known-directory set
- **AND** the server SHALL NOT spawn `openspec list` / `openspec status` for it on periodic ticks

#### Scenario: Hidden session does not extend poll load
- **WHEN** an ended session is hidden via `POST /api/session/:id/hide`
- **THEN** the server SHALL NOT poll its cwd on account of that session (hiding an ended session never re-adds it to the work set)

#### Scenario: Pinned directory with only ended sessions still polls
- **WHEN** a directory is pinned but all its sessions have ended
- **THEN** the server SHALL continue to poll that directory (pinning is an explicit watch signal independent of session state)

#### Scenario: Reopening an ended cwd repopulates it
- **WHEN** a session registers in a cwd that was previously excluded (all prior sessions ended)
- **THEN** the server SHALL immediately poll that cwd via the new-directory path and broadcast its `openspec_update`

#### Scenario: openspec CLI not available
- **WHEN** `openspec` is not installed or the directory is not an openspec project
- **THEN** the server SHALL cache `{ initialized: false, pending: false, changes: [] }` for that directory

#### Scenario: Browser requests immediate refresh
- **WHEN** a browser sends `openspec_refresh` with a `cwd` field
- **THEN** the server SHALL immediately re-poll the openspec CLI for that directory, **bypassing change detection** but still respecting the concurrency cap, and broadcast the result

### Requirement: Change-detection gate to avoid redundant CLI invocations

The server SHALL support an mtime-based change-detection gate that skips `openspec list` / `openspec status` CLI invocations when no tracked artifact in `openspec/changes/` has changed since the last successful poll. The gate SHALL be controlled by `DashboardConfig.openspec.changeDetection` with values `"mtime"` (default) and `"always"` (re-poll unconditionally, matching pre-change behavior).

The gate SHALL use **file-aware effective mtime** rather than directory mtime alone, because POSIX directory mtime does not advance when a file inside the directory is edited in place.

#### Scenario: List-step gate signal

- **WHEN** `changeDetection` is `"mtime"` and the cache has a previous `listResult`
- **THEN** the server SHALL compute the list-step effective mtime as the maximum of:
  - `mtime(<cwd>/openspec/changes/)`
  - `mtime(<cwd>/openspec/changes/<name>/tasks.md)` for each `<name>` in the cached list result
- **AND** the server SHALL skip `openspec list` and reuse the cached `listResult` when this effective mtime equals the cached value

#### Scenario: Per-change status-step gate signal

- **WHEN** `changeDetection` is `"mtime"` and the per-change cache has an entry for `<name>`
- **THEN** the server SHALL compute the per-change effective mtime as the maximum of:
  - `mtime(<cwd>/openspec/changes/<name>/)`
  - `mtime(<cwd>/openspec/changes/<name>/tasks.md)`
  - `mtime(<cwd>/openspec/changes/<name>/proposal.md)`
  - `mtime(<cwd>/openspec/changes/<name>/design.md)`
  - `mtime(<cwd>/openspec/changes/<name>/specs/)`
  - `mtime(<cwd>/openspec/changes/<name>/specs/<cap>/)` for each immediate child directory of `specs/`
  - `mtime(<cwd>/openspec/changes/<name>/specs/<cap>/spec.md)` for each immediate child directory of `specs/` that contains a `spec.md`
- **AND** the server SHALL skip `openspec status --change <name>` and reuse the cached entry when this effective mtime equals the cached value
- **AND** missing files or directories (e.g. a change with no `specs/` yet) SHALL be excluded from the maximum (treated as "skip"), not treated as zero or `NaN`
- **AND** enumeration of `specs/<cap>/` directories MUST be wrapped in a `try`/`catch` (or equivalent) so that an `ENOENT` on `<change>/specs/` returns an empty fan-out rather than throwing

#### Scenario: Unchanged directory skips list CLI

- **WHEN** the list-step effective mtime matches the cached value
- **THEN** the server SHALL reuse the cached `list` result and SHALL NOT spawn `openspec list`

#### Scenario: Unchanged change skips status CLI

- **WHEN** the per-change effective mtime matches the cached value for that change
- **THEN** the server SHALL reuse the cached status entry and SHALL NOT spawn `openspec status --change <name>`

#### Scenario: In-place edit to tasks.md re-runs status

- **WHEN** an external actor (the user's IDE, the agent's `Edit` tool, the openspec CLI's `change update`) writes new content to `openspec/changes/foo/tasks.md` without renaming or recreating the file
- **THEN** on the next gated poll the server SHALL spawn `openspec list` exactly once
- **AND** SHALL spawn `openspec status --change foo` exactly once
- **AND** SHALL NOT spawn `openspec status` for any other unchanged change in the same directory
- **AND** the resulting `openspec_update` broadcast SHALL carry the new `completedTasks` value

#### Scenario: In-place edit to proposal.md or design.md re-runs status

- **WHEN** an external actor writes new content to `openspec/changes/foo/proposal.md` or `openspec/changes/foo/design.md` without renaming
- **THEN** on the next gated poll the server SHALL spawn `openspec status --change foo` exactly once
- **AND** SHALL NOT spawn `openspec status` for any other unchanged change

#### Scenario: New capability subdirectory created under specs/

- **WHEN** an external actor creates a new directory `openspec/changes/foo/specs/<cap>/` (e.g. `mkdir specs/mobile-resilience`)
- **THEN** `mtime(<cwd>/openspec/changes/foo/specs/)` SHALL advance
- **AND** on the next gated poll the server SHALL spawn `openspec status --change foo` exactly once
- **AND** SHALL NOT spawn `openspec status` for any other unchanged change

#### Scenario: New spec.md file created inside an existing capability directory

- **WHEN** an external actor writes `openspec/changes/foo/specs/<cap>/spec.md` for the first time, where `specs/<cap>/` already existed
- **THEN** `mtime(<cwd>/openspec/changes/foo/specs/<cap>/)` SHALL advance (POSIX entry-create semantics)
- **AND** on the next gated poll the server SHALL spawn `openspec status --change foo` exactly once
- **AND** the resulting `openspec_update` broadcast SHALL reflect the new `specs` artifact status (typically a transition from `ready` → `done`)
- **AND** SHALL NOT spawn `openspec status` for any other unchanged change

#### Scenario: In-place edit to existing spec.md re-runs status

- **WHEN** an external actor writes new content to an existing `openspec/changes/foo/specs/<cap>/spec.md` without renaming or recreating the file
- **THEN** `mtime(openspec/changes/foo/specs/<cap>/spec.md)` SHALL advance
- **AND** on the next gated poll the server SHALL spawn `openspec status --change foo` exactly once
- **AND** SHALL NOT spawn `openspec status` for any other unchanged change

#### Scenario: Deletion of a capability subdirectory under specs/

- **WHEN** an external actor removes `openspec/changes/foo/specs/<cap>/` (e.g. `rm -rf specs/mobile-resilience`)
- **THEN** `mtime(<cwd>/openspec/changes/foo/specs/)` SHALL advance
- **AND** on the next gated poll the server SHALL spawn `openspec status --change foo` exactly once
- **AND** the per-change cache SHALL stamp the new effective mtime so subsequent unchanged ticks again hit the gate

#### Scenario: Multi-spec authoring after a no-specs poll does not stale the cache

- **GIVEN** the dashboard polled `foo` once when `<change>/specs/` did not yet exist (or contained no `spec.md` files), and the cache stamped `specs: ready`
- **WHEN** the user subsequently authors `specs/<cap-a>/spec.md` and `specs/<cap-b>/spec.md`
- **THEN** the per-change effective mtime computed on the next poll SHALL differ from the stamped value
- **AND** the server SHALL spawn `openspec status --change foo` exactly once
- **AND** the resulting cache entry SHALL reflect the post-authoring artifact statuses
- **AND** the dashboard SHALL NOT continue serving the stale `specs: ready` from cache

#### Scenario: Change added or removed

- **WHEN** a new change directory appears, or an existing one is deleted or archived
- **THEN** `mtime(<cwd>/openspec/changes/)` SHALL advance, causing `openspec list` to run
- **AND** the per-change cache SHALL be pruned of entries no longer present in the list result

#### Scenario: First poll with no cached list result

- **WHEN** the cache for a directory has no `listResult` (e.g. server start, freshly added directory)
- **THEN** the gate SHALL be skipped and `openspec list` SHALL run unconditionally

#### Scenario: Change-detection disabled

- **WHEN** `changeDetection` is `"always"`
- **THEN** the server SHALL run `openspec list` and all `openspec status` invocations on every poll tick (matching pre-change behavior)

#### Scenario: Force refresh bypasses the gate

- **WHEN** `openspec_refresh { cwd }` is received, or `refreshOpenSpec(cwd)` is called by server code (`force === true`)
- **THEN** the change-detection gate SHALL be bypassed and the CLI SHALL be invoked authoritatively (the list step plus `openspec status` per change)
- **AND** force-mode is the manual escape hatch when local derivation and the CLI disagree

#### Scenario: Internal gated paths honor the gate

- **WHEN** the periodic poll, `pollDirectoryGated(cwd)`, or `onDirectoryAdded(cwd)` runs (`force === false`)
- **THEN** the change-detection gate SHALL be evaluated with the file-aware effective mtime
- **AND** the per-change step SHALL run only for changes whose effective mtime has advanced

NOTE: This is a third delta on the same `Change-detection gate to avoid redundant CLI invocations` requirement. Prior deltas: `fix-openspec-mtime-gate-blind-spots` (added `tasks.md`/`proposal.md`/`design.md` to the watch set), `fix-openspec-mtime-gate-toctou` (added the post-call effective-mtime re-check). This delta extends the watch set to `specs/**` and is otherwise additive — every prior scenario remains in force.

### Requirement: Local specs evidence promotes the specs artifact status

The dashboard SHALL post-process the per-change `artifacts` array returned by `openspec status --change <name> --json` so that the `specs` artifact's `status` is promoted from `"ready"` to `"done"` when local file-system evidence indicates spec authoring is satisfied. The override MUST NOT alter any other artifact id, MUST NOT demote `"done"` to any other value, and MUST NOT promote `"blocked"` directly to `"done"`.

The override SHALL be implemented as a pure rule evaluator in a new module `packages/shared/src/openspec-specs-evidence.ts`, parallel in shape to the existing `openspec-design-evidence.ts`, plus an injected probe factory threaded through `buildOpenSpecData(...)` and the production poll paths.

#### Scenario: any spec.md under specs/ satisfies specs

- **WHEN** the change directory contains at least one file matching `specs/**/*.md`
- **AND** the CLI reports `artifacts[specs].status === "ready"`
- **THEN** `artifacts[specs].status` SHALL be promoted to `"done"`.

#### Scenario: empty specs directory does not satisfy specs

- **WHEN** the change directory contains a `specs/` directory but no `*.md` files anywhere underneath it
- **THEN** `artifacts[specs].status` SHALL remain `"ready"` (matches CLI verdict).

#### Scenario: missing specs directory does not throw

- **WHEN** the change directory does not contain a `specs/` directory at all
- **THEN** the probe SHALL return `false` without throwing
- **AND** `artifacts[specs].status` SHALL remain unchanged from the CLI verdict.

#### Scenario: blocked specs artifact is never promoted

- **WHEN** the CLI reports `artifacts[specs].status === "blocked"`
- **THEN** the override SHALL NOT promote it to `"done"` regardless of local evidence.

#### Scenario: done specs artifact is never demoted

- **WHEN** the CLI reports `artifacts[specs].status === "done"`
- **THEN** the override SHALL NOT alter the status (no-op promote-only override).

#### Scenario: only specs artifact may be mutated

- **WHEN** the override evaluates a change
- **THEN** the `status` of every artifact other than `specs` SHALL be passed through unchanged from the CLI verdict.

#### Scenario: probe factory is optional in buildOpenSpecData

- **WHEN** `buildOpenSpecData(...)` is called without a `specsProbeFactory` argument
- **THEN** the function SHALL match the pre-change behavior verbatim (no specs override fires)
- **AND** test callers that omit the factory SHALL continue to pass.

### Requirement: Change-level isComplete agrees with overridden specs artifact

After the specs-artifact override is applied, the dashboard SHALL re-derive the change-level `isComplete` flag using the same logic that the design override already triggers (post-override, all artifacts done ⇒ promote `isComplete: false → true`; never demote CLI `true`).

#### Scenario: all artifacts done after specs override

- **WHEN** every artifact in the post-override `artifacts` array has `status === "done"`
- **THEN** `isComplete` SHALL be `true`.

#### Scenario: specs promoted but other artifact still not done

- **WHEN** the specs override promotes `specs: ready → done` but at least one other artifact is `ready` or `blocked`
- **THEN** `isComplete` SHALL be the value reported by the CLI (no promotion to true based on a partial promotion).

### Requirement: TOCTOU-safe mtime stamping in the gated poll
The server SHALL stamp into the per-change cache an mtime value that demonstrably reflects the file state observed by the `openspec status --change <name>` CLI invocation. The gated-poll implementation SHALL NOT update the per-change cache entry for `<name>` when the file-aware effective mtime of the tracked artifact paths changed during the CLI invocation.

This requirement closes a latent race in which a write to `openspec/changes/<name>/{tasks,proposal,design}.md` (or to `openspec/changes/<name>/` itself, e.g. file creation) lands between the moment `openspec status` scans the directory and the moment the post-call `stat()` is taken. Without this requirement, the cache could record `{ mtimeMs: post-write, status: pre-write }`, after which the gate would correctly find `current mtime == cached mtime` on every subsequent tick and reuse the stale status indefinitely.

#### Scenario: No write during the CLI invocation
- **WHEN** `openspec status --change <name>` is invoked during a gated poll
- **AND** no write to the tracked artifact paths occurs between the pre-call `stat()` and the post-call `stat()`
- **THEN** the server SHALL stamp the cache entry as `{ mtimeMs: <pre-call mtime>, change: <CLI result> }`

#### Scenario: Write during the CLI invocation is detected and discarded
- **WHEN** `openspec status --change <name>` is invoked during a gated poll
- **AND** any tracked artifact path is written between the pre-call `stat()` and the post-call `stat()` (causing pre-call mtime ≠ post-call mtime)
- **THEN** the server SHALL NOT update the per-change cache entry for `<name>` on this tick
- **AND** the existing cache entry (if any) SHALL be preserved unchanged
- **AND** the next gated poll tick SHALL re-spawn `openspec status --change <name>` because the post-write effective mtime differs from the (preserved) cached `mtimeMs`

#### Scenario: Bulk fast-forward authoring does not poison the cache
- **WHEN** an external authoring flow (`/opsx:ff`, agent `Edit` tool, the user's IDE) writes `proposal.md`, `design.md`, `specs/**/*.md`, and `tasks.md` for a single change in rapid succession
- **AND** a periodic gated poll tick lands during this authoring window
- **THEN** within at most one additional gated poll tick after authoring completes, the cache SHALL reflect the post-authoring artifact statuses
- **AND** the dashboard's `openspec_update` broadcast SHALL carry the post-authoring statuses

#### Scenario: Discard path emits a debug-only diagnostic
- **WHEN** the discard branch fires (pre-call mtime ≠ post-call mtime)
- **AND** the `DEBUG` environment variable matches `pi-dashboard|openspec-poll`
- **THEN** the server SHALL emit a single `console.warn` line citing the change name, pre-call mtime, post-call mtime, and `[fix-openspec-mtime-gate-toctou]`
- **AND** when `DEBUG` is unset, the discard SHALL be silent

### Requirement: Concurrency cap on openspec CLI spawns
The server SHALL cap the number of concurrent `openspec` CLI invocations across all directories and all changes at `DashboardConfig.openspec.maxConcurrentSpawns` (default 3, range 1–16). Invocations exceeding the cap SHALL queue FIFO and run as slots free up. Force-refresh paths SHALL also honor the cap.

#### Scenario: Burst is serialized
- **WHEN** 20 directories each need 5 `openspec status` invocations at once and `maxConcurrentSpawns` is 3
- **THEN** at most 3 `openspec` child processes SHALL be running simultaneously
- **AND** all 100 invocations SHALL complete in sequence without errors

#### Scenario: Resize takes effect without restart
- **WHEN** `maxConcurrentSpawns` is changed from 3 to 8 via `PUT /api/config`
- **THEN** the semaphore SHALL immediately allow up to 8 concurrent spawns for new work
- **AND** in-flight spawns under the old cap SHALL be unaffected

#### Scenario: Refresh storm is throttled
- **WHEN** a browser sends 20 `openspec_refresh` messages concurrently for the same cwd
- **THEN** at most `maxConcurrentSpawns` openspec CLI invocations SHALL be in flight at any time

### Requirement: OpenSpec data keyed by directory in browser protocol
The server SHALL send `openspec_update` messages to browsers keyed by `cwd` instead of `sessionId`.

#### Scenario: Browser receives openspec_update
- **WHEN** the server broadcasts an openspec_update
- **THEN** the message SHALL contain `{ type: "openspec_update", cwd: string, data: OpenSpecData }` with no sessionId field

#### Scenario: Browser connects and receives initial state
- **WHEN** a browser WebSocket connects
- **THEN** the server SHALL emit exactly one `openspec_update` per cwd in `knownDirectories()`:
  - `{ initialized: true, changes: [...] }` when the cache holds populated data
  - `{ initialized: false, pending: true, changes: [] }` when `<cwd>/openspec/changes/` exists (synchronous fs detection) but slow-poll data has not yet been cached
  - `{ initialized: false, pending: false, changes: [] }` when `<cwd>/openspec/changes/` does not exist
- **AND** the server SHALL NOT silently omit any known cwd from the initial snapshot

### Requirement: OpenSpec data carries a pending flag for cold-boot signaling

The `OpenSpecData` payload SHALL carry an optional `pending: boolean`
field that disambiguates "no `openspec/changes/` directory" from
"directory exists but slow poll has not yet completed". The field is
optional for backwards compatibility; absence means
`pending === false`.

#### Scenario: Pending true when openspec dir exists but cache empty

- **WHEN** a browser connects and the server has a known cwd whose
  `openspec/changes/` directory exists but `getOpenSpecData(cwd)`
  returns `undefined` or `{ initialized: false }`
- **THEN** the server SHALL emit
  `openspec_update { cwd, data: { initialized: false, pending: true, changes: [] } }`

#### Scenario: Pending false when no openspec dir

- **WHEN** a browser connects and the server has a known cwd whose
  `openspec/changes/` directory does not exist
- **THEN** the server SHALL emit
  `openspec_update { cwd, data: { initialized: false, pending: false, changes: [] } }`

#### Scenario: Pending omitted once data initialized

- **WHEN** the slow poll completes successfully and the cache holds
  `{ initialized: true, changes: [...] }`
- **THEN** broadcasts SHALL emit `data: { initialized: true, changes: [...] }`
  with no `pending` field set (or `pending: false`)

### Requirement: Bootstrap broadcasts initial poll completion
The server SHALL broadcast `openspec_update` for any cwd whose bootstrap initial poll produces data that differs from the prior cache (including a transition from empty/undefined to populated), using the same `priorEmpty || dataDiffers` predicate as `runPostInstallRepair`.

#### Scenario: Cold boot with browser already connected

- **WHEN** a browser connects to the server before bootstrap's initial
  `refreshOpenSpec(cwd)` has resolved for cwd `/project/foo`
- **AND** the openspec/changes/ directory under `/project/foo` is later
  successfully polled with N>0 changes
- **THEN** the server SHALL broadcast
  `openspec_update { cwd: "/project/foo", data: { initialized: true, changes: [...] } }`
  to the connected browser without requiring a manual reload

#### Scenario: Warm restart without data change

- **WHEN** the bootstrap initial poll resolves and the freshly-polled
  data is identical to the prior cache (e.g. on a hot reload where
  the cache survived)
- **THEN** the server SHALL NOT emit a redundant `openspec_update`
  for that cwd

### Requirement: Deduplicated polling across sessions
The server SHALL poll each directory at most once per polling interval, regardless of how many sessions are registered for that directory.

#### Scenario: Multiple sessions in same directory
- **WHEN** three sessions are registered for `/project/foo`
- **THEN** the server SHALL run the openspec CLI at most once per interval for `/project/foo`, not three times

### Requirement: Server skips OpenSpec polling when `openspec.enabled` is false
The server SHALL gate ALL OpenSpec polling on `DashboardConfig.openspec.enabled`. When `enabled === false`:
- the per-directory poll loop SHALL not invoke `openspec list --json` or `openspec status --change <name> --json` for any directory;
- on-demand `openspec_refresh` requests from browsers SHALL be acknowledged but SHALL NOT trigger CLI invocations (the server SHALL respond as if the directory has no `openspec/` directory);
- the in-memory `OpenSpecData` cache for every known cwd SHALL be cleared (set to `{ initialized: false, pending: false, changes: [] }`) the first time the disabled state is observed by the polling loop, and the corresponding `openspec_update` SHALL be broadcast to all connected browsers so existing UIs converge to the disabled-state shape.

When `enabled` flips back to `true` via `PUT /api/config` and `directoryService.reconfigurePolling`, the server SHALL resume normal polling on the next tick (no immediate burst-poll required).

#### Scenario: No CLI spawns while disabled
- **WHEN** `DashboardConfig.openspec.enabled` is `false` for the entire poll interval
- **AND** there are 5 known directories
- **THEN** zero `openspec` CLI processes SHALL be spawned during that interval

#### Scenario: Cache cleared and broadcast on disable transition
- **WHEN** the cache contains `{ initialized: true, changes: [...non-empty...] }` for cwd `C` at time T
- **AND** `openspec.enabled` is set to `false` via `PUT /api/config` at time T+1
- **THEN** the server SHALL broadcast an `openspec_update` for cwd `C` with payload `{ initialized: false, pending: false, changes: [] }` within one poll tick
- **AND** the in-memory cache for `C` SHALL be `{ initialized: false, pending: false, changes: [] }`

#### Scenario: openspec_refresh is a no-op while disabled
- **WHEN** `openspec.enabled` is `false`
- **AND** a browser sends `openspec_refresh` with `cwd: "C"`
- **THEN** the server SHALL NOT spawn any `openspec` CLI process
- **AND** SHALL broadcast `openspec_update` with `{ initialized: false, pending: false, changes: [] }` for cwd `C`

#### Scenario: Polling resumes on re-enable
- **WHEN** `openspec.enabled` flips from `false` to `true` via `PUT /api/config`
- **THEN** the next regular poll tick SHALL evaluate every known directory normally (subject to change-detection and concurrency caps)
- **AND** the resulting `openspec_update` broadcasts SHALL reflect the actual on-disk state

### Requirement: Push refresh on local filesystem change to openspec/changes/

The server SHALL maintain a per-cwd filesystem watcher on `<cwd>/openspec/changes/` (recursive) for every known directory. When a write, rename, or create event affects a file whose relative path matches `tasks.md`, `proposal.md`, `design.md`, or `specs/**/*.md`, the server SHALL trigger an mtime-gated re-poll of that cwd within a debounce window of ≤ 1 second (default 300 ms), reusing the same `pollOne(cwd, force=false)` path as the periodic timer. The watcher SHALL NOT bypass the mtime-gate, the concurrency cap, or the broadcast dedup — it is a *trigger*, not a parallel poll path.

#### Scenario: User ticks a checkbox in tasks.md
- **WHEN** an editor writes a modified `<cwd>/openspec/changes/<change>/tasks.md` and the file's mtime advances
- **THEN** the server SHALL invoke `pollOne(cwd, force=false)` within 1 second of the write
- **AND** SHALL broadcast `openspec_update` with the refreshed data

#### Scenario: Rapid edits coalesce
- **WHEN** five writes to `tasks.md` occur within 300 ms
- **THEN** the watcher SHALL fire `pollOne` at most once (trailing-edge debounce)

#### Scenario: Filename outside the openspec contract
- **WHEN** a watcher event fires for `<cwd>/openspec/changes/<change>/README.md` or `<cwd>/openspec/changes/<change>/.openspec.yaml`
- **THEN** the server SHALL NOT trigger a poll on that event alone

#### Scenario: mtime-gate dedup still applies
- **WHEN** two watcher events fire for the same `tasks.md` without an mtime advance between them (e.g. duplicate fs.watch event)
- **THEN** the second `pollOne` call SHALL be skipped by the mtime-gate
- **AND** at most one `openspec status` CLI spawn SHALL result

#### Scenario: openspec/changes/ directory does not exist
- **WHEN** a cwd is registered that does not yet contain `openspec/changes/`
- **THEN** the watcher SHALL NOT throw
- **AND** the periodic poll SHALL continue to cover that cwd
- **AND** when `openspec/changes/` is later created, the watcher SHALL be attached on the next periodic poll tick that observes the cwd (failed attaches are retried)

#### Scenario: Watcher initialization fails with EMFILE / EACCES
- **WHEN** `fs.watch(...)` throws an OS-level resource error for a cwd
- **THEN** the server SHALL log once (DEBUG) and mark that cwd's watcher as degraded
- **AND** SHALL NOT crash the polling subsystem
- **AND** the periodic poll SHALL continue to provide correctness for that cwd

#### Scenario: Cwd is forgotten
- **WHEN** a pinned directory is unpinned, or the last session for a cwd unregisters and the cwd is no longer "known"
- **THEN** the server SHALL detach the watcher for that cwd
- **AND** SHALL clear any pending debounce timer

#### Scenario: Server graceful shutdown
- **WHEN** the server stops (SIGTERM / `pi-dashboard stop` / `/api/restart`)
- **THEN** all attached watchers SHALL be detached before process exit

### Requirement: Periodic poll derives artifact status without per-change CLI spawn

On the periodic / gated poll path (`force === false`), the server SHALL derive
each change's per-artifact status (`proposal`, `design`, `tasks`, `specs`) and
change-level `isComplete` from local files and the `openspec list --json`
entry, WITHOUT spawning `openspec status` per change. The CLI `openspec status`
spawn is reserved for user-initiated force-refresh (`force === true`).

Net openspec CLI spawns on the periodic path SHALL be at most one per
directory per tick (`openspec list`), independent of the number of changes.

#### Scenario: Many changes → one spawn per cwd per tick

- **GIVEN** a cwd with N active changes (N large, e.g. 66)
- **WHEN** the periodic poll tick runs for that cwd
- **THEN** the server spawns `openspec list` at most once for that cwd
- **AND** spawns `openspec status` zero times
- **AND** still returns an `OpenSpecData` whose `changes[].artifacts` and
  `changes[].isComplete` are populated from local derivation

#### Scenario: Artifact status derived from local evidence

- **GIVEN** a change whose `tasks.md` has all checkboxes ticked, a
  `design.md` present, and at least one `specs/**/*.md`
- **WHEN** the periodic poll derives status
- **THEN** the `tasks`, `design`, `specs`, and `proposal` artifacts are
  reported `done` and the change `isComplete` is `true`

#### Scenario: Force-refresh remains CLI-authoritative

- **GIVEN** the user clicks the OpenSpec Refresh control (`force === true`)
- **WHEN** `refreshOpenSpec(cwd)` runs
- **THEN** the server spawns `openspec status` per change as the authoritative
  source and the gate is bypassed

### Requirement: Local derivation parity with CLI is guarded by test

The derived per-artifact status SHALL match `openspec status --json` output
artifact-for-artifact for a representative change set, enforced by an
automated test that skips gracefully when the `openspec` CLI is unavailable.

#### Scenario: Derived status equals CLI status

- **GIVEN** the `openspec` CLI is available and the repo has active changes
- **WHEN** the parity test derives status locally and via the CLI for each
  change
- **THEN** the two artifact lists are equal per change

### Requirement: Poll path emits transitional pending before the slow CLI spawn

The server SHALL broadcast a transitional `openspec_update` with
`data: { initialized: false, pending: true, changes: [] }` at the start of any
poll for a directory whose `<cwd>/openspec/changes/` directory exists (cheap
synchronous fs detection) AND whose cached `OpenSpecData` does not yet hold
`initialized: true`, **before** invoking the slow `openspec list` CLI. The
authoritative `openspec_update` (with the final `initialized` payload) SHALL
follow when the CLI returns.

This requirement is independent of the cold-boot connect snapshot
(`buildOpenSpecConnectSnapshot`). It SHALL apply to every poll path that can
surface a newly-present openspec directory: new-cwd registration
(`onDirectoryAdded`), the periodic poll tick, and the watcher-fired re-poll.
These paths all funnel through `pollDirectoryGated`, so the transitional emit
MAY be realized as a single helper at that choke point.
The transitional emit closes the gap where a directory whose `openspec/` is
created **after** the cwd is first registered (e.g. a delayed `openspec init`
hook in a fresh worktree) would otherwise jump straight from "no data" to
`initialized: true`, skipping the loading spinner.

#### Scenario: New worktree with committed openspec dir shows pending then ready

- **WHEN** a new cwd registers and `<cwd>/openspec/changes/` already exists on
  disk but no `initialized` data is cached
- **THEN** the server SHALL broadcast `openspec_update` with
  `{ initialized: false, pending: true, changes: [] }` before the `openspec list`
  CLI spawn
- **AND** SHALL broadcast `openspec_update` with the final
  `{ initialized: true, changes: [...] }` payload when the CLI returns

#### Scenario: Directory gains openspec after registration

- **WHEN** a cwd was registered while `<cwd>/openspec/changes/` did not exist
- **AND** the directory is created later (e.g. an init hook runs)
- **AND** a periodic tick or watcher-fired re-poll discovers it
- **THEN** that discovery poll SHALL broadcast
  `{ initialized: false, pending: true, changes: [] }` before the CLI spawn
- **AND** SHALL broadcast the final `initialized` payload when the CLI returns
- **AND** SHALL NOT jump directly from no-data to `initialized: true` without a
  transitional pending broadcast

#### Scenario: No pending for non-openspec directory

- **WHEN** a cwd whose `<cwd>/openspec/changes/` does not exist is polled
- **THEN** the server SHALL NOT broadcast any `pending: true` payload for that
  cwd
- **AND** the cached/broadcast payload SHALL remain
  `{ initialized: false, pending: false, changes: [] }`

#### Scenario: No pending for init-only directory without changes subdir

- **WHEN** a cwd has `<cwd>/openspec/` but no `<cwd>/openspec/changes/`
  subdirectory (openspec initialized, no proposals authored)
- **THEN** the server SHALL NOT emit a `pending: true` payload for that cwd
- **AND** SHALL NOT leave a spinner showing indefinitely

#### Scenario: Pending clears on empty or failed terminal poll

- **WHEN** a `pending: true` payload was broadcast for a cwd
- **AND** the subsequent `openspec list` CLI returns no usable data (error or
  empty), yielding `{ initialized: false }`
- **THEN** the final broadcast SHALL carry `pending: false` (or omit `pending`)
  so the folder section resolves `!initialized && !pending` to render-nothing
  and the spinner clears

### Requirement: Periodic poll derivation runs off the main event loop

On the periodic / gated poll path (`force === false`), the server SHALL perform per-change artifact derivation (local fs evidence probes) and payload serialization in a `worker_threads` worker, so this CPU-bound and synchronous-fs work does not block the main event loop that serves HTTP requests and WebSocket frames. The main thread SHALL retain ownership of the `openspec list` CLI spawn, the spawn-concurrency semaphore, the per-cwd cache, the mtime/TOCTOU gate stamping, and the broadcast.

The worker behavior SHALL be governed by `DashboardConfig.openspec.useWorker` (default `true`). When `false`, derivation SHALL run in-process exactly as on the pre-worker path.

The force-refresh path (authoritative `openspec status --change` per change) SHALL remain on its existing async-spawn path and SHALL NOT require the worker.

#### Scenario: Derived payload is byte-identical to in-process derivation
- **WHEN** the worker derives `OpenSpecData` for a directory
- **THEN** the resulting `data` SHALL equal the in-process derivation for the same inputs
- **AND** the serialized payload SHALL equal `JSON.stringify(data)`

#### Scenario: Worker unavailable falls back in-process
- **WHEN** the worker cannot be spawned, times out, or crashes during a tick
- **THEN** the server SHALL derive that directory's data in-process for that cycle
- **AND** the broadcast SHALL still be emitted with correct, uncorrupted data

#### Scenario: useWorker disabled
- **WHEN** `DashboardConfig.openspec.useWorker` is `false`
- **THEN** the server SHALL run all derivation in-process and SHALL NOT spawn the poll worker

#### Scenario: Payload serialized exactly once per tick
- **WHEN** a directory's gated poll completes via the worker
- **THEN** the payload SHALL be serialized once (in the worker) and that serialized string SHALL be reused for both the change-detection diff and the broadcast
