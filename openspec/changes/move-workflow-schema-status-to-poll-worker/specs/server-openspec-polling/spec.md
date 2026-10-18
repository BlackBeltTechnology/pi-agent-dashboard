## MODIFIED Requirements

### Requirement: Cwd-level change-detection gate for the status-all poll

On the `--all` path the server SHALL support an mtime-based change-detection gate, controlled by `DashboardConfig.openspec.changeDetection` (`"mtime"` default, `"always"`), that skips the `openspec status --all` invocation for a directory when no tracked path changed since the last successful poll. The gate SHALL use file-aware effective mtime (max over tracked paths), because POSIX directory mtime does not advance on in-place edits. The tracked-path `stat` probe SHALL run in the poll worker when `useWorker` is true and the worker is healthy; otherwise it SHALL run in-process with bounded-concurrency async `stat`. The same applies to the post-call build: in-process file I/O (re-stats, task-file and schema reads) SHALL be async and bounded; only JSON parsing and pure computation MAY run synchronously. Paths reported by the CLI SHALL be relativized against `root.path` exactly as emitted (the CLI already canonicalizes it with `realpathSync.native`) and separator-normalized. The server SHALL canonicalize its own `<cwd>/openspec/` once per cwd with `realpathSync.native` and map CLI-relative paths onto its probe and watcher paths through that canonical root; a CLI path that would escape it SHALL be ignored. Symlinked subdirectories inside a change are not followed. The force path SHALL use the same probe and build requests as the gated path.

Tracked paths for a directory SHALL be:
- `<cwd>/openspec/` itself, `<cwd>/openspec/changes/`, `<cwd>/openspec/config.yaml`, and every directory and file under `<cwd>/openspec/schemas/` (directory mtimes catch deletions and renames that a max-over-files would miss);
- for every change in the cached result: the change directory, its `.openspec.yaml`, the legacy fixed set (`tasks.md`, `proposal.md`, `design.md`, `specs/`, `specs/<cap>/`, `specs/<cap>/spec.md`), every path in `artifactPaths.<id>.existingOutputPaths`, the parent directory of each such path, for a non-glob output its `resolvedOutputPath` and that path's parent directory (so a not-yet-created output is detected when it appears), and for a glob output its static directory prefix (e.g. `specs/`) plus every directory beneath that prefix (so a first file created in an empty nested directory is detected).

The gate governs the `openspec status --all` invocation and the reuse of per-change data. It does NOT govern `OpenSpecData.workflowSchema`, which is recomputed on every tick regardless of a gate hit (see "Workflow-schema status is computed in the poll worker on every poll tick").

Before the first successful `--all` result (cold cache, or after a whole-call failure) the per-change set is the legacy fixed set for every enumerated change directory. Missing paths SHALL be skipped, not treated as zero; directory enumeration SHALL NOT throw on `ENOENT`.

#### Scenario: Unchanged directory skips the CLI

- **WHEN** the effective mtime equals the cached value
- **THEN** the server SHALL reuse cached data and SHALL NOT spawn `openspec status --all`
- **AND** `OpenSpecData.workflowSchema` SHALL NOT be reused from that cached data: it is recomputed by the worker request of "Workflow-schema status is computed in the poll worker on every poll tick" (whose poll-configuration rebroadcast exception is not a tick)

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

## ADDED Requirements

### Requirement: Workflow-schema status is computed in the poll worker on every poll tick

The filesystem part of `OpenSpecData.workflowSchema` (configured schema, stamp comparison, `missing`, `unpinnedChanges`, `affectedChanges`) SHALL be computed by a dedicated poll-worker request on every poll tick for a cwd, on every success path (cache-gate hit, status-all build, fallback list build, force refresh), and SHALL NOT be taken from the cached `OpenSpecData` of a previous tick: a finalized payload's `workflowSchema` SHALL be set only from the current tick's result, and any `workflowSchema` on the object being finalized SHALL be dropped first. The only exception is a poll-configuration change that re-derives readiness from the cached finalized payload without a tick; it MAY keep that payload's `workflowSchema` until the next tick. Attachment remains subject to the readiness rule of `openspec-workflow-schema` ("Workflow schema status is reported separately from readiness"). Apart from the pool's in-process fallback below, the computation SHALL NOT run on the main event loop.

- The request SHALL be enqueued at most once per tick. On the status-all path it SHALL be enqueued after the same cwd's tracked-path probe request; on the fallback list path, which has no probe, it SHALL be enqueued before the list spawn, and the tick that detects `--all` as unsupported SHALL reuse the request it already enqueued. It is awaited only when the payload is finalized; the build SHALL NOT wait for it. A tick that fails after enqueueing SHALL discard the result without an unhandled rejection.
- Reads of the per-change `.openspec.yaml` files SHALL use bounded concurrency (at most 16 in flight per request). The stamp comparison SHALL be decided from the stamp alone, and the whole-directory content fingerprint SHALL be computed only when that comparison is `newer` or `conflict`.
- The worker and the in-process fallback SHALL dispatch request kinds exhaustively: a request kind without a handler SHALL fail, never run another kind's body.
- Worker unavailability, a worker error or a per-request timeout SHALL fall back to the same computation run as bounded async I/O in-process, through the pool's existing fallback; there SHALL be exactly one implementation of the computation, shared by both.
- When the worker's comparison is `newer` or `conflict`, the worker SHALL return the whole-directory fingerprint instead of a verdict. The main thread SHALL run `openspec schema validate pi-spec-driven` through the shared spawn semaphore, memoized by (cwd, fingerprint, resolved CLI version), and report `incompatible` when it fails. No other CLI call SHALL be made for the status.
- A computation failure SHALL omit `workflowSchema` for that tick, including when the previous tick's payload carried one (the payload is otherwise unchanged). It SHALL be logged once per run of consecutive failing ticks for that cwd, with the fallback taken; a successful tick re-arms the log.
- The REST workflow-schema endpoint and the poll SHALL use the same spawn semaphore instance, including after the poll configuration resizes it.

#### Scenario: CLI upgrade on a gate-hit tick

- **GIVEN** a directory whose last poll gate-hit and whose stamp was `current` against CLI 1.11.0
- **WHEN** the resolved CLI version becomes 1.12.0 without any tracked path moving
- **THEN** the next tick SHALL report `generated === "outdated"`
- **AND** no `openspec status --all` process SHALL be spawned for that tick

#### Scenario: User-schema-directory change is seen on a gate-hit tick

- **GIVEN** a directory whose config names a schema resolvable only from the user schema directory, and whose last tick reported `missing === false`
- **WHEN** that schema is removed from the user schema directory without any tracked path moving
- **THEN** the next tick SHALL report `workflowSchema.missing === true`
- **AND** no `openspec status --all` process SHALL be spawned for that tick

#### Scenario: `config.yml`-only default is seen on a gate-hit tick

- **GIVEN** a directory with only `openspec/config.yml` naming `spec-driven`, and a gate-hit tick
- **WHEN** `openspec/config.yml` is rewritten to name `pi-spec-driven`
- **THEN** the next tick SHALL report `workflowSchema.configured === "pi-spec-driven"`

#### Scenario: Fallback list path carries the status

- **GIVEN** a CLI classified as not supporting `status --all`
- **WHEN** a tick builds the payload from `openspec list`
- **THEN** `workflowSchema` SHALL be present with the same worker-computed content

#### Scenario: Failure does not resurrect a cached status

- **GIVEN** a previous tick that broadcast `workflowSchema.generated === "current"`, and a gate-hit tick whose status computation throws in both the worker and the in-process fallback
- **WHEN** the tick finalizes
- **THEN** the broadcast payload SHALL contain no `workflowSchema` key

#### Scenario: Worker disabled, same result

- **GIVEN** `openspec.useWorker === false`
- **WHEN** a tick computes the status for a fixture
- **THEN** the result SHALL be deeply equal to the worker-computed result for the same fixture

#### Scenario: Worker failure falls back without losing the status

- **GIVEN** the poll worker errors on the status request
- **WHEN** a tick runs
- **THEN** the in-process fallback SHALL supply `workflowSchema` and the tick SHALL still broadcast

#### Scenario: Newer stamp validates once on the main thread

- **GIVEN** a `newer` stamp and a stubbed `schema validate` that exits 1
- **WHEN** three consecutive ticks run with the same (cwd, fingerprint, CLI version)
- **THEN** `generated` SHALL be `incompatible` on each tick
- **AND** exactly one `schema validate` process SHALL have been spawned, through the shared semaphore

#### Scenario: Poll and route share one cap

- **GIVEN** `maxConcurrentSpawns = 1` and a poll spawn in flight
- **WHEN** the REST endpoint needs a `schema validate`
- **THEN** it SHALL wait for the semaphore instead of running concurrently
