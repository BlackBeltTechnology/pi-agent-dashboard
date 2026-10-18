## MODIFIED Requirements

### Requirement: Cwd-level change-detection gate for the status-all poll

On the `--all` path the server SHALL support an mtime-based change-detection gate, controlled by `DashboardConfig.openspec.changeDetection` (`"mtime"` default, `"always"`), that skips the `openspec status --all` invocation for a directory when no tracked path changed since the last successful poll. The gate SHALL use file-aware effective mtime (max over tracked paths), because POSIX directory mtime does not advance on in-place edits. The tracked-path `stat` probe SHALL run in the poll worker when `useWorker` is true and the worker is healthy; otherwise it SHALL run in-process with bounded-concurrency async `stat`. The same applies to the post-call build: in-process file I/O (re-stats, task-file and schema reads) SHALL be async and bounded; only JSON parsing and pure computation MAY run synchronously. Paths reported by the CLI SHALL be relativized against `root.path` exactly as emitted (the CLI already canonicalizes it with `realpathSync.native`) and separator-normalized. The server SHALL canonicalize its own `<cwd>/openspec/` once per cwd with `realpathSync.native` and map CLI-relative paths onto its probe and watcher paths through that canonical root; a CLI path that would escape it SHALL be ignored. Symlinked subdirectories inside a change are not followed. The force path SHALL use the same probe and build requests as the gated path.

Tracked paths for a directory SHALL be:
- `<cwd>/openspec/` itself, `<cwd>/openspec/changes/`, `<cwd>/openspec/config.yaml`, and every directory and file under `<cwd>/openspec/schemas/` (directory mtimes catch deletions and renames that a max-over-files would miss);
- for every change in the cached result: the change directory, its `.openspec.yaml`, the legacy fixed set (`tasks.md`, `proposal.md`, `design.md`, `dependencies.yaml`, `specs/`, `specs/<cap>/`, `specs/<cap>/spec.md`), every path in `artifactPaths.<id>.existingOutputPaths`, the parent directory of each such path, for a non-glob output its `resolvedOutputPath` and that path's parent directory (so a not-yet-created output is detected when it appears), and for a glob output its static directory prefix (e.g. `specs/`) plus every directory beneath that prefix (so a first file created in an empty nested directory is detected).
- `<cwd>/openspec/specs/` and, for every capability that has a delta in any active change, `<cwd>/openspec/specs/<cap>/` and `<cwd>/openspec/specs/<cap>/spec.md` (stat only, never watched; the directory mtimes catch deletions), because dependency inference reads whether that main spec exists;
- `<cwd>/openspec/changes/archive/` (its directory mtime changes when a change is archived, which satisfies dependency edges).

Before the first successful `--all` result (cold cache, or after a whole-call failure) the per-change set is the legacy fixed set for every enumerated change directory. Missing paths SHALL be skipped, not treated as zero; directory enumeration SHALL NOT throw on `ENOENT`.

#### Scenario: Unchanged directory skips the CLI

- **WHEN** the effective mtime equals the cached value
- **THEN** the server SHALL reuse cached data and SHALL NOT spawn `openspec status --all`

#### Scenario: In-place edit to any tracked artifact re-runs the CLI once

- **WHEN** an external actor edits `tasks.md`, `proposal.md`, `design.md`, a `specs/<cap>/spec.md` or a schema-declared output such as `dependencies.yaml` in place
- **THEN** the next gated poll SHALL spawn `openspec status --all` exactly once for that cwd

#### Scenario: Metadata, config or schema edit re-runs the CLI

- **WHEN** a change's `.openspec.yaml`, `openspec/config.yaml`, or a file under `openspec/schemas/` is created or edited
- **THEN** the next gated poll SHALL spawn `openspec status --all` exactly once

#### Scenario: Change added, removed or archived

- **WHEN** a change directory appears, is deleted, or is moved to `archive/`
- **THEN** `mtime(<cwd>/openspec/changes/)` SHALL advance and the next gated poll SHALL spawn `openspec status --all`
- **AND** cache entries for changes absent from the result SHALL be pruned

#### Scenario: No-op tick keeps the main thread free

- **GIVEN** 107 unchanged changes
- **WHEN** a gated tick runs
- **THEN** the tracked-path stats SHALL run in the worker (or as yielding async stats when the worker is disabled or unhealthy)
- **AND** no main-thread turn of that tick SHALL exceed the per-turn alarm threshold of "Per-turn main-thread work does not block the event loop"

#### Scenario: Change-detection disabled

- **WHEN** `changeDetection` is `"always"`
- **THEN** every tick SHALL spawn `openspec status --all`

#### Scenario: Force refresh bypasses the gate

- **WHEN** `openspec_refresh { cwd }` is received or `refreshOpenSpec(cwd)` is called
- **THEN** the gate SHALL be bypassed and `openspec status --all` SHALL run

#### Scenario: Dependencies file of a spec-driven change is tracked

- **GIVEN** a `spec-driven` change `foo` (no dependencies artifact in its schema) in the cached result
- **WHEN** `foo/dependencies.yaml` is created or edited
- **THEN** the effective mtime SHALL advance and the next gated poll SHALL spawn `openspec status --all`

#### Scenario: Main spec creation or deletion is noticed by the gate

- **GIVEN** an active change has a delta for `push-notifications`
- **WHEN** `openspec/specs/push-notifications/spec.md` is created by a spec sync, or deleted by a branch switch
- **THEN** the next periodic gated poll SHALL rebuild the directory's data

### Requirement: Push refresh on local filesystem change to openspec/changes/

The server SHALL maintain, for every known directory, a recursive filesystem watcher on `<cwd>/openspec/changes/`, plus a non-recursive watcher on `<cwd>/openspec/` (for `config.yaml`) and a recursive watcher on `<cwd>/openspec/schemas/` when it exists. Main specs under `<cwd>/openspec/specs/` SHALL NOT be watched. A relevant event is a write, rename, or create that affects: (a) a change directory itself (creation or rename of `changes/<change>/`), or under any `changes/<change>/` directory `tasks.md`, `proposal.md`, `design.md`, `dependencies.yaml`, `specs/**/*.md` or `.openspec.yaml` (also for change directories not yet in the cached result); (b) under a change directory present in the cached `openspec status --all` result, a path matching one of that change's artifact outputs — tested against each `artifactPaths.<id>.resolvedOutputPath` (glob-aware, relativized against `root.path` as emitted and mapped onto the server's canonical `<cwd>/openspec/`, separator-normalized), so a not-yet-created output such as `dependencies.yaml` matches; or (c) `openspec/config.yaml` or any file under `openspec/schemas/`. On a relevant event the server SHALL trigger an mtime-gated re-poll of that cwd within a debounce window of ≤ 1 second (default 300 ms), reusing the same `pollOne(cwd, force=false)` path as the periodic timer. The watcher SHALL NOT bypass the mtime-gate, the concurrency cap, or the broadcast dedup — it is a *trigger*, not a parallel poll path.

#### Scenario: User ticks a checkbox in tasks.md
- **WHEN** an editor writes a modified `<cwd>/openspec/changes/<change>/tasks.md` and the file's mtime advances
- **THEN** the server SHALL invoke `pollOne(cwd, force=false)` within 1 second of the write
- **AND** SHALL broadcast `openspec_update` with the refreshed data

#### Scenario: Rapid edits coalesce
- **WHEN** five writes to `tasks.md` occur within 300 ms
- **THEN** the watcher SHALL fire `pollOne` at most once (trailing-edge debounce)

#### Scenario: Filename outside the openspec contract
- **WHEN** a watcher event fires for `<cwd>/openspec/changes/<change>/README.md` (not a tracked artifact output) or for a main spec under `<cwd>/openspec/specs/`
- **THEN** the server SHALL NOT trigger a poll on that event alone
- **AND WHEN** a watcher event fires for `<cwd>/openspec/changes/<change>/.openspec.yaml`, a schema-declared output such as `dependencies.yaml`, `openspec/config.yaml`, or a file under `openspec/schemas/`
- **THEN** the server SHALL trigger the debounced gated re-poll

#### Scenario: mtime-gate dedup still applies
- **WHEN** two watcher events fire for the same `tasks.md` without an mtime advance between them (e.g. duplicate fs.watch event)
- **THEN** the second `pollOne` call SHALL be skipped by the mtime-gate
- **AND** at most one OpenSpec status call SHALL result

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

#### Scenario: Editing a spec-driven change's dependencies refreshes the board
- **GIVEN** a `spec-driven` change (no dependencies artifact in its schema)
- **WHEN** its `dependencies.yaml` is written
- **THEN** a gated re-poll SHALL run within the watcher debounce window and the broadcast SHALL carry the new edges

### Requirement: TOCTOU-safe stamping around the status-all invocation

On the `--all` path the server SHALL take each change's pre-call effective mtime in the worker probe before invoking `openspec status --all` and re-take it in the worker after the call returns. A change whose effective mtime changed during the call SHALL be marked racy: its cache entry SHALL NOT be updated on this tick (previous entry preserved, except its `dependencies` field, which is always recomputed for every change from the files read in this build — see `openspec-change-dependencies`) and its stamp SHALL NOT advance, so the next gated tick re-polls. Non-racy changes SHALL be stamped with their pre-call mtime. The cwd-level stamp (`openspec/`, `changes/`, `config.yaml`, `schemas/**`, `changes/archive/`, `openspec/specs/` and the tracked main-spec paths) SHALL be the pre-call value; if any cwd-level path changed during the call, the cwd-level stamp SHALL NOT advance, so the next gated tick re-polls. A change present in the result but absent from the pre-call probe (created between probe and spawn) SHALL be applied from the result but left unstamped, so the next gated tick re-polls it once. A change deleted during the call SHALL be pruned (pruning wins over preservation). With `DEBUG` matching `pi-dashboard|openspec-poll`, each discard SHALL emit one `console.warn` naming the change and both mtimes; otherwise silent.

#### Scenario: No write during the call

- **WHEN** no tracked path changes between the pre-call and post-call stat
- **THEN** every change SHALL be stamped with its pre-call mtime and the CLI result

#### Scenario: Write during the call is discarded for that change only

- **WHEN** `openspec/changes/foo/tasks.md` is written while `openspec status --all` runs
- **THEN** `foo` SHALL keep its previous cache entry and stamp
- **AND** other changes SHALL be updated from the result
- **AND** the next gated tick SHALL spawn `openspec status --all` again

#### Scenario: Change deleted during the call is pruned

- **WHEN** `openspec/changes/bar/` is removed while `openspec status --all` runs
- **THEN** `bar` SHALL NOT appear in the broadcast of this tick or later ticks

#### Scenario: Bulk fast-forward authoring converges

- **WHEN** `/opsx:ff` writes `proposal.md`, `design.md`, `specs/**` and `tasks.md` in rapid succession while a gated tick runs
- **THEN** within one additional gated tick after authoring completes the broadcast SHALL carry the post-authoring statuses

#### Scenario: Archive during the call

- **WHEN** a change is archived (its directory moves under `changes/archive/`) while `openspec status --all` runs
- **THEN** the cwd-level stamp SHALL NOT advance and the next gated tick SHALL re-poll
