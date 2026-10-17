## ADDED Requirements

### Requirement: Poll paths use one `openspec status --all` spawn per directory

When the resolved CLI supports it, both the periodic / gated poll path (`force === false`) and the user-initiated force-refresh path (`force === true`) SHALL obtain per-change artifact status, `isComplete`, `schemaName` and `artifactPaths` from a single `openspec status --all --json` invocation per directory, through the spawn-concurrency semaphore, with a timeout of 30 s. The server SHALL NOT spawn `openspec list` or per-change `openspec status --change <name>` on either path while `--all` is supported.

The existing pre-spawn short-circuit SHALL be retained: when `<cwd>/openspec/changes/` does not exist, no CLI SHALL be spawned and the directory SHALL resolve to `initialized: false` (readiness `missing-changes-dir`).

The CLI verdict SHALL be the artifact status source for every schema; the existing promote-only design/specs evidence overrides SHALL still apply on top of it. `OpenSpecChange.artifacts` SHALL be emitted in canonical order — `proposal`, `design`, `specs`, `tasks` (those present) — followed by any other artifact ids in CLI order, on both the gated and the force path (previously the force path broadcast the CLI's `proposal, specs, design, tasks` order while the gated path used canonical order). `OpenSpecData.changes` SHALL be ordered by the probe's per-change effective mtime, newest first, ties by name; the probe SHALL enumerate `changes/*` directories itself (excluding `archive/`), so every change — including one created since the last poll and every change on a cold cache — has a probe mtime. (This approximates, but does not reproduce, `openspec list`'s recursive-mtime order; clients that re-sort are unaffected.) The transitional `pending` broadcast SHALL be emitted before the tracked-path probe is dispatched.

A failure of the `--all` call on the force path SHALL NOT be retried within that refresh and SHALL NOT fall back to a per-change spawn fan-out; it SHALL be handled as a whole-call failure (see "Status-all output is validated as an envelope") — unless it is the call that first classifies the CLI as unsupported, in which case the fallback requirement governs.

#### Scenario: Many changes, one spawn

- **GIVEN** a cwd with 102 active changes
- **WHEN** a gated poll for that cwd passes the change-detection gate
- **THEN** exactly one `openspec status --all --json` process SHALL be spawned for that cwd
- **AND** zero `openspec list` and zero `openspec status --change` processes SHALL be spawned

#### Scenario: Force refresh is a single spawn

- **WHEN** the user clicks the OpenSpec Refresh control for a cwd with N active changes
- **THEN** exactly one `openspec status --all --json` process SHALL be spawned, independent of N
- **AND** a failure of that call SHALL NOT trigger a second `--all` spawn or a per-change spawn fan-out (the only exception is the call that first classifies the CLI as unsupported — see the fallback requirement)

#### Scenario: Cold force refresh that fails stays empty and broken

- **GIVEN** a cwd with no cached OpenSpec data
- **WHEN** a force refresh's `openspec status --all` is a whole-call failure
- **THEN** the broadcast SHALL be `{ initialized: false, pending: false, changes: [] }` with readiness `BROKEN` / `cli-failed`
- **AND** no further `openspec` process SHALL be spawned for that refresh

#### Scenario: Most recently edited change first

- **GIVEN** changes `a` (tracked files last modified yesterday) and `b` (`tasks.md` modified now)
- **WHEN** the poll completes
- **THEN** `changes` SHALL list `b` before `a`

#### Scenario: Missing changes dir spawns nothing

- **GIVEN** `<cwd>/openspec/` exists but `<cwd>/openspec/changes/` does not
- **WHEN** any poll runs for that cwd
- **THEN** no `openspec` process SHALL be spawned
- **AND** readiness SHALL be `BROKEN` with reason `missing-changes-dir`

#### Scenario: Custom schema artifacts are reported in stable order

- **GIVEN** a change whose schema declares an extra artifact `dependencies` generating `dependencies.yaml`
- **WHEN** the poll completes
- **THEN** that change's `artifacts` SHALL list `proposal`, `design`, `specs`, `tasks`, then `dependencies`
- **AND** `isComplete` SHALL be the CLI value (after promote-only overrides)

### Requirement: Status-all output is validated as an envelope

The `openspec status --all` recipe SHALL return raw stdout regardless of the process exit code, plus stderr when the exit code is non-zero (from the failed-execution result, not via a tolerate-and-drop-stderr path); JSON parsing (with the existing preamble tolerance) and classification SHALL run in the poll worker, or in-process when the worker is disabled or unhealthy. The fallback classification ("Fallback when `openspec status --all` is unsupported") SHALL be checked first; otherwise the result SHALL be classified:

- **Whole-call failure** → handled exactly like today's failed OpenSpec CLI call: cached data becomes `{ initialized: false, pending: false, changes: [] }`, readiness `BROKEN` / `cli-failed`, and the next gated tick SHALL retry the call (one spawn per cwd per tick, the same retry cadence as today's failed `openspec list`, `directory-service.ts:918-933`). Applies when stdout has no parseable JSON; OR the top level carries `status` entries with `severity: "error"`; OR `root` is `null`; OR `root.source` is `"implicit"`.
- **Success** → otherwise. Each change entry carrying `status: [{ severity: "error", code, message }]` and no `artifacts` SHALL map to an `OpenSpecChange` with `error: { code, message }`, `artifacts: []`, and task counts from the top-level `tasks.md` fallback (see "Local task counting follows OpenSpec's task-line rule"). An entry with neither `artifacts` nor `status` SHALL map the same way with `error.code: "unknown-entry"`. Before caching or broadcasting, control characters SHALL be stripped from `code` and `message`, `message` SHALL be collapsed to a single line of at most 500 characters and `code` truncated to 64 characters. (Paths inside messages remain visible to paired clients, as other cwd paths already are.)

#### Scenario: One broken change does not blank the directory

- **GIVEN** 102 active changes, one of which has an invalid `.openspec.yaml`
- **WHEN** `openspec status --all --json` exits with code 1 and prints JSON for all 102
- **THEN** the broadcast `OpenSpecData` SHALL contain all 102 changes with `initialized: true`
- **AND** the broken change SHALL carry `error.code === "change_error"` and the (capped) CLI message

#### Scenario: Unknown schema is a per-change error

- **GIVEN** a change pinned to a schema that is not present locally
- **WHEN** the poll completes
- **THEN** only that change SHALL carry an `error` naming the missing schema

#### Scenario: Whole-call failure payload is a CLI failure

- **WHEN** `openspec status --all --json` prints `{ "changes": [], "root": null, "status": [{ "severity": "error", "code": "invalid_store_pointer", "message": "…" }] }` and exits 1
- **THEN** the poll SHALL be treated as a CLI failure (readiness `cli-failed`)
- **AND** the directory SHALL NOT be broadcast as `initialized: true` with zero changes

#### Scenario: No JSON at all is still a failure

- **WHEN** `openspec status --all` prints no JSON body
- **THEN** the poll SHALL be treated as a CLI failure, not as an empty change list

#### Scenario: Oversized error message is capped

- **WHEN** a change's CLI error message is 4 000 characters across several lines
- **THEN** the broadcast `error.message` SHALL be one line of at most 500 characters

### Requirement: Local task counting follows OpenSpec's task-line rule

The server SHALL compute `completedTasks`, `totalTasks` and the list-level `status` for each change locally, in the poll worker, using OpenSpec's task-line rule: every line matching `/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/` counts (indented and fenced lines included); `x`/`X` is done. `status` SHALL be `no-tasks` when `totalTasks` is 0, `complete` when `completedTasks === totalTasks`, else `in-progress`.

The counted files SHALL be selected as OpenSpec does:
1. Determine `apply.tracks` for the change's `schemaName` by OpenSpec's schema resolution order: project-local `openspec/schemas/<name>/schema.yaml`, then the user schema directory (`$XDG_DATA_HOME/openspec/schemas/<name>/schema.yaml`, default `~/.local/share/…`), then the built-in package schema (`spec-driven` tracks `tasks.md`). The first existing file wins for any name, including `spec-driven`. Files are parsed with the `yaml` package and memoized by mtime; an unreadable or unparsable file means `apply.tracks` is absent.
2. If `apply.tracks` is set, the tracked artifact is the one whose `outputPath` equals it (none matching → no tracked artifact). If it is absent, the tracked artifact is the one with id `tasks`.
3. All of the tracked artifact's `existingOutputPaths` are counted and summed.
4. When no tracked artifact or no existing output resolves (including change entries with an `error`), the top-level `<change>/tasks.md` is counted if present — as OpenSpec does when the change's metadata or schema cannot be resolved.

This selection SHALL match OpenSpec's counts for every resolvable schema.

The task-editor parser (`parseTasksMarkdown`) SHALL NOT be used for counts.

#### Scenario: Indented sub-tasks count

- **GIVEN** a `tasks.md` with 34 top-level and 3 indented `- [ ]` lines, 16 checked
- **WHEN** the poll counts tasks
- **THEN** `totalTasks` SHALL be 37 and `completedTasks` 16

#### Scenario: Broken change still counts its tasks.md

- **GIVEN** a change with an invalid `.openspec.yaml` and a `tasks.md` holding 9 checkboxes
- **WHEN** the poll completes
- **THEN** its `totalTasks` SHALL be 9, matching `openspec list --json`

#### Scenario: Project schema tracks a different file

- **GIVEN** a project-local schema whose `apply.tracks` is `plan.md` produced by artifact `plan`
- **WHEN** the poll counts tasks for a change on that schema
- **THEN** checkboxes in `plan.md` SHALL be counted and `tasks.md` SHALL be ignored

#### Scenario: No tasks file

- **WHEN** a change has no tracked output and no top-level `tasks.md`
- **THEN** `totalTasks` and `completedTasks` SHALL be 0 and `status` SHALL be `no-tasks`

### Requirement: Cwd-level change-detection gate for the status-all poll

On the `--all` path the server SHALL support an mtime-based change-detection gate, controlled by `DashboardConfig.openspec.changeDetection` (`"mtime"` default, `"always"`), that skips the `openspec status --all` invocation for a directory when no tracked path changed since the last successful poll. The gate SHALL use file-aware effective mtime (max over tracked paths), because POSIX directory mtime does not advance on in-place edits. The tracked-path `stat` probe SHALL run in the poll worker when `useWorker` is true and the worker is healthy; otherwise it SHALL run in-process with bounded-concurrency async `stat`. The same applies to the post-call build: in-process file I/O (re-stats, task-file and schema reads) SHALL be async and bounded; only JSON parsing and pure computation MAY run synchronously. Paths reported by the CLI SHALL be relativized against `root.path` exactly as emitted (the CLI already canonicalizes it with `realpathSync.native`) and separator-normalized. The server SHALL canonicalize its own `<cwd>/openspec/` once per cwd with `realpathSync.native` and map CLI-relative paths onto its probe and watcher paths through that canonical root; a CLI path that would escape it SHALL be ignored. Symlinked subdirectories inside a change are not followed. The force path SHALL use the same probe and build requests as the gated path.

Tracked paths for a directory SHALL be:
- `<cwd>/openspec/` itself, `<cwd>/openspec/changes/`, `<cwd>/openspec/config.yaml`, and every directory and file under `<cwd>/openspec/schemas/` (directory mtimes catch deletions and renames that a max-over-files would miss);
- for every change in the cached result: the change directory, its `.openspec.yaml`, the legacy fixed set (`tasks.md`, `proposal.md`, `design.md`, `specs/`, `specs/<cap>/`, `specs/<cap>/spec.md`), every path in `artifactPaths.<id>.existingOutputPaths`, the parent directory of each such path, for a non-glob output its `resolvedOutputPath` and that path's parent directory (so a not-yet-created output is detected when it appears), and for a glob output its static directory prefix (e.g. `specs/`) plus every directory beneath that prefix (so a first file created in an empty nested directory is detected).

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

### Requirement: TOCTOU-safe stamping around the status-all invocation

On the `--all` path the server SHALL take each change's pre-call effective mtime in the worker probe before invoking `openspec status --all` and re-take it in the worker after the call returns. A change whose effective mtime changed during the call SHALL be marked racy: its cache entry SHALL NOT be updated on this tick (previous entry preserved) and its stamp SHALL NOT advance, so the next gated tick re-polls. Non-racy changes SHALL be stamped with their pre-call mtime. The cwd-level stamp (`openspec/`, `changes/`, `config.yaml`, `schemas/**`) SHALL be the pre-call value; if any cwd-level path changed during the call, the cwd-level stamp SHALL NOT advance, so the next gated tick re-polls. A change present in the result but absent from the pre-call probe (created between probe and spawn) SHALL be applied from the result but left unstamped, so the next gated tick re-polls it once. A change deleted during the call SHALL be pruned (pruning wins over preservation). With `DEBUG` matching `pi-dashboard|openspec-poll`, each discard SHALL emit one `console.warn` naming the change and both mtimes; otherwise silent.

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

### Requirement: Fallback when `openspec status --all` is unsupported

The server SHALL classify the resolved `openspec` CLI as not supporting `--all` when an `openspec status --all --json` call yields no JSON body and its stderr or stdout matches `/unknown option ['"]?--all/i`. On the call that first makes this classification, the same poll SHALL immediately continue on the fallback path (this is the only case in which one poll spawns more than one OpenSpec process). The classification SHALL be cached per resolved CLI installation, keyed by the `version` of the `@fission-ai/openspec` package found by resolving the CLI entry (`realpath` of the resolved binary or script, then walking up to the nearest `package.json` with that name). When no such `package.json` is found, the classification SHALL be cached for the process lifetime and re-evaluated on every force refresh. The `bin/openspec.js` shim's mtime SHALL NOT be used as a key: upgrades do not touch it. It SHALL be checked before envelope classification. While unsupported, the poll paths SHALL use the fallback path: `openspec list` plus local artifact derivation on the gated path and per-change `openspec status --change` on force refresh, as specified by the fallback-scoped requirements "Change-detection gate to avoid redundant CLI invocations", "TOCTOU-safe mtime stamping in the gated poll", "Periodic poll derives artifact status without per-change CLI spawn" and "Local derivation parity with CLI is guarded by test".

#### Scenario: Old CLI keeps working

- **GIVEN** an `openspec` CLI that rejects `status --all` with "error: unknown option '--all'"
- **WHEN** gated polls run
- **THEN** the first poll SHALL continue on the fallback path in the same poll and broadcast data (not `cli-failed`)
- **AND** later polls SHALL spawn `openspec list` and derive artifacts locally, as before this change
- **AND** SHALL NOT retry `--all` on later ticks while the resolved package `version` is unchanged

#### Scenario: Upgraded CLI is picked up

- **GIVEN** the CLI was classified unsupported
- **WHEN** the resolved CLI is upgraded (its package `version` changes)
- **THEN** the next poll SHALL try `openspec status --all` again

### Requirement: Status-all and task-count parity is guarded by test

An automated test SHALL assert, for the repo's active changes:
- (a) every change WITHOUT a CLI error has an artifact list from `openspec status --all --json` equal (as a set of `id:status`) to `openspec status --change <name> --json`;
- (b) every change WITH an error in `--all` also fails in the per-change call;
- (c) locally counted `completedTasks`/`totalTasks` equal `openspec list --json` for every change present in both outputs whose schema is project-local or built-in.

Per-change spawns SHALL run through a bounded concurrency pool. The test SHALL skip only when the CLI is genuinely absent; a parse failure SHALL fail the test.

#### Scenario: Parity holds

- **GIVEN** the CLI is available and the repo has active changes
- **WHEN** the parity test runs
- **THEN** artifact sets and task counts SHALL match per change

#### Scenario: Parse failure is not a skip

- **WHEN** the CLI is present but its output cannot be parsed
- **THEN** the test SHALL fail rather than take the CLI-absent skip

## MODIFIED Requirements

### Requirement: Server polls openspec CLI per directory
The server SHALL obtain each known directory's change status through the OpenSpec status call — ONE `openspec status --all --json` invocation per poll (see "Poll paths use one `openspec status --all` spawn per directory"), or on the fallback path `openspec list --json` plus local derivation (see "Fallback when `openspec status --all` is unsupported") — at a **configurable interval** (default 30 seconds, range 5–3600 seconds, controlled by `DashboardConfig.openspec.pollIntervalSeconds`) and broadcast results keyed by cwd to connected browsers. Each directory's poll SHALL be offset within the interval by a deterministic per-cwd phase (range 0 to `DashboardConfig.openspec.jitterSeconds`, default 5 s) so that polls do not all align on the same tick.

The set of **known directories** SHALL be the union of:
- every explicitly **pinned** directory, and
- the cwd of every session whose status is **not** `"ended"` (i.e. active sessions).

Ended sessions — including hidden ones — SHALL NOT contribute their cwd to the known-directory set. A directory whose sessions have all ended and that is not pinned SHALL stop being polled until a new session registers in it or it is pinned.

A browser-initiated `openspec_refresh` SHALL be subject to the same admission gates as the on-demand `openspec_get` fetch: OpenSpec globally enabled, the cwd not opted out, the cwd present in the session registry (any status) or pinned, and `<cwd>/openspec/` present. A refresh that fails any gate SHALL spawn no process, SHALL NOT probe the filesystem below the cwd before the tracked-cwd gate has passed, and SHALL NOT broadcast.

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
- **AND** the server SHALL NOT spawn any `openspec` CLI process for it on periodic ticks

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
- **WHEN** a browser sends `openspec_refresh` with a `cwd` that is pinned or present in the session registry, is not opted out, and contains `openspec/`
- **THEN** the server SHALL immediately re-poll the openspec CLI for that directory, **bypassing change detection** but still respecting the concurrency cap, and broadcast the result

#### Scenario: Refresh for an untracked directory does not spawn
- **GIVEN** `/tmp/anywhere` is neither pinned nor present in the session registry
- **WHEN** a paired browser sends `openspec_refresh { cwd: "/tmp/anywhere" }`
- **THEN** no OpenSpec CLI process SHALL be spawned
- **AND** no `openspec_update` SHALL be broadcast for that cwd
- **AND** the server SHALL NOT stat any path below `/tmp/anywhere`

#### Scenario: Refresh for an opted-out directory does not spawn
- **GIVEN** `/repo/a` is tracked and its cwd is opted out of OpenSpec polling
- **WHEN** a browser sends `openspec_refresh { cwd: "/repo/a" }`
- **THEN** no OpenSpec CLI process SHALL be spawned

#### Scenario: Refresh for a tracked directory without an openspec root does not spawn
- **GIVEN** `/repo/c` is tracked but has no `openspec/` directory
- **WHEN** a browser sends `openspec_refresh { cwd: "/repo/c" }`
- **THEN** no OpenSpec CLI process SHALL be spawned

### Requirement: Push refresh on local filesystem change to openspec/changes/

The server SHALL maintain, for every known directory, a recursive filesystem watcher on `<cwd>/openspec/changes/`, plus a non-recursive watcher on `<cwd>/openspec/` (for `config.yaml`) and a recursive watcher on `<cwd>/openspec/schemas/` when it exists. Main specs under `<cwd>/openspec/specs/` SHALL NOT be watched. A relevant event is a write, rename, or create that affects: (a) a change directory itself (creation or rename of `changes/<change>/`), or under any `changes/<change>/` directory `tasks.md`, `proposal.md`, `design.md`, `specs/**/*.md` or `.openspec.yaml` (also for change directories not yet in the cached result); (b) under a change directory present in the cached `openspec status --all` result, a path matching one of that change's artifact outputs — tested against each `artifactPaths.<id>.resolvedOutputPath` (glob-aware, relativized against `root.path` as emitted and mapped onto the server's canonical `<cwd>/openspec/`, separator-normalized), so a not-yet-created output such as `dependencies.yaml` matches; or (c) `openspec/config.yaml` or any file under `openspec/schemas/`. On a relevant event the server SHALL trigger an mtime-gated re-poll of that cwd within a debounce window of ≤ 1 second (default 300 ms), reusing the same `pollOne(cwd, force=false)` path as the periodic timer. The watcher SHALL NOT bypass the mtime-gate, the concurrency cap, or the broadcast dedup — it is a *trigger*, not a parallel poll path.

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

### Requirement: Poll path emits transitional pending before the slow CLI spawn

The server SHALL broadcast a transitional `openspec_update` with
`data: { initialized: false, pending: true, changes: [] }` at the start of any
poll for a directory whose `<cwd>/openspec/changes/` directory exists (cheap
synchronous fs detection) AND whose cached `OpenSpecData` does not yet hold
`initialized: true`, **before** invoking the slow OpenSpec status call (`openspec status --all`, or `openspec list` on the fallback path). The
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
  `{ initialized: false, pending: true, changes: [] }` before the OpenSpec status
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
- **AND** the subsequent OpenSpec status call returns no usable data (error or
  empty), yielding `{ initialized: false }`
- **THEN** the final broadcast SHALL carry `pending: false` (or omit `pending`)
  so the folder section resolves `!initialized && !pending` to render-nothing
  and the spinner clears

### Requirement: Periodic poll derivation runs off the main event loop

On the periodic / gated poll path (`force === false`), the server SHALL perform all per-change filesystem work — the pre-call tracked-path `stat` probe, the post-call TOCTOU re-stat, local task counting, promote-only evidence overrides, payload build (and, on the fallback path, local artifact derivation) — and payload serialization in a `worker_threads` worker, so this CPU-bound and synchronous-fs work does not block the main event loop that serves HTTP requests and WebSocket frames. The main thread SHALL retain ownership of the OpenSpec status CLI spawn (`openspec status --all`, or `openspec list` on the fallback path), the spawn-concurrency semaphore, the per-cwd cache, the mtime/TOCTOU gate stamping, and the broadcast.

The worker behavior SHALL be governed by `DashboardConfig.openspec.useWorker` (default `true`). When `false`, the same work SHALL run in-process, with file I/O performed as bounded async I/O (only JSON parsing and pure computation synchronous) so the per-turn budget keeps holding.

The force-refresh path SHALL use the same single `openspec status --all` spawn (per-change `openspec status --change` only on the fallback path) and the same worker probe/build requests as the gated path.

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

### Requirement: Server skips OpenSpec polling when `openspec.enabled` is false
The server SHALL gate ALL OpenSpec polling on `DashboardConfig.openspec.enabled`. When `enabled === false`:
- the per-directory poll loop SHALL not invoke any `openspec` CLI command (`status --all`, or the fallback `list` / `status --change`) for any directory;
- on-demand `openspec_refresh` requests from browsers SHALL NOT trigger CLI invocations and SHALL NOT broadcast (the refresh admission gate rejects them);
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
- **AND** SHALL NOT broadcast `openspec_update` for cwd `C`

#### Scenario: Polling resumes on re-enable
- **WHEN** `openspec.enabled` flips from `false` to `true` via `PUT /api/config`
- **THEN** the next regular poll tick SHALL evaluate every known directory normally (subject to change-detection and concurrency caps)
- **AND** the resulting `openspec_update` broadcasts SHALL reflect the actual on-disk state

### Requirement: The poll path self-attributes its per-turn synchronous cost

The server SHALL time the synchronous run of each instrumented event-loop turn on
the OpenSpec poll path with a monotonic clock and, when a turn's own synchronous
run exceeds a configured floor, self-record an observation (timestamp, duration,
turn label) into the event-loop stall buffer defined in `server-session-hydration`.
Attribution SHALL be per single synchronous turn, NEVER a sum across turns,
because the tick's synchronous work is spread across many turns: the `setInterval`
turn (`tickOpen`: the folder-head git-HEAD poll `tickFolderHeads`,
`reconcileWatchers`, `computeKnownDirectories`) and, per directory, the turns
split by the `await`s — `dirPollPre` (the `changes/` existence check, the transitional pending emit and, on the fallback path, the list-signal `stat`s, before the first worker call), on the `--all` path `dirPollGate` (gate comparison of the worker's tracked-path probe result and the status CLI spawn) and `dirPollCli` (CLI stdout received → build request dispatched to the worker), and `dirPollPost` (worker-response deserialization and the
broadcast after it resolves). The per-change TOCTOU mtime stamping runs inside the
worker and is NOT a main-thread turn.

#### Scenario: A synthetic single-turn block is self-attributed
- **WHEN** an instrumented turn's own synchronous run exceeds the floor
- **THEN** the server SHALL self-record an observation labelled with that turn

#### Scenario: Work split by an await is not counted as one turn
- **GIVEN** synchronous work runs both before and after the worker `await` in a directory's poll callback
- **WHEN** the per-turn timing is applied
- **THEN** the pre-await and post-await runs SHALL be timed as separate turns (`dirPollPre`, `dirPollPost`), not summed across the await

### Requirement: Per-turn main-thread work does not block the event loop

The server SHALL NOT allow any single instrumented turn's synchronous main-thread
work — `tickOpen`, `dirPollPre`, `dirPollGate`, `dirPollCli`, or `dirPollPost` — to block the main event loop
for a duration that stalls WebSocket frame delivery to connected clients. Such
work SHALL either run off the main thread, be gated so it performs no synchronous
filesystem or child-process work when its inputs are unchanged, or yield to the
event loop (bounded-concurrency async I/O or chunking) so no single turn produces
one uninterrupted synchronous burst.

The folder-head poll SHALL, whichever remedy is applied, continue to surface a
directory's updated git HEAD on the next tick after its ref state advances; a
remedy MUST NOT suppress a branch switch. Remedies that reorder per-directory
`git_head_update` relative to `openspec_update` MUST either preserve per-cwd
ordering or be confirmed client-tolerant.

#### Scenario: A no-op tick produces no per-turn stall
- **GIVEN** no pinned or active-session directory has changed git HEAD, openspec artifacts, or membership since the previous tick
- **WHEN** a periodic poll tick runs
- **THEN** no instrumented turn of that tick SHALL self-record a synchronous duration above the configured floor

#### Scenario: Branch switch still reflects on the next tick
- **WHEN** a directory's git HEAD advances between ticks
- **THEN** the folder-head poll SHALL re-read that directory's HEAD and surface the updated head on the next tick

### Requirement: Local specs evidence promotes the specs artifact status

The dashboard SHALL post-process the per-change `artifacts` array returned by the OpenSpec status call (`openspec status --all --json`, or `openspec status --change <name> --json` on the fallback path) so that the `specs` artifact's `status` is promoted from `"ready"` to `"done"` when local file-system evidence indicates spec authoring is satisfied. The override MUST NOT alter any other artifact id, MUST NOT demote `"done"` to any other value, and MUST NOT promote `"blocked"` directly to `"done"`.

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

### Requirement: Change-detection gate to avoid redundant CLI invocations

**Scope (fallback path only):** this requirement governs polling when the resolved `openspec` CLI does not support `status --all` (see "Fallback when `openspec status --all` is unsupported"). When `--all` is supported, "Cwd-level change-detection gate for the status-all poll" applies instead.

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

### Requirement: TOCTOU-safe mtime stamping in the gated poll

**Scope (fallback path only):** this requirement governs polling when the resolved `openspec` CLI does not support `status --all` (see "Fallback when `openspec status --all` is unsupported"). When `--all` is supported, "TOCTOU-safe stamping around the status-all invocation" applies instead.

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

### Requirement: Periodic poll derives artifact status without per-change CLI spawn

**Scope (fallback path only):** this requirement governs polling when the resolved `openspec` CLI does not support `status --all` (see "Fallback when `openspec status --all` is unsupported"). When `--all` is supported, "Poll paths use one `openspec status --all` spawn per directory" applies instead.

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

**Scope (fallback path only):** this requirement governs polling when the resolved `openspec` CLI does not support `status --all` (see "Fallback when `openspec status --all` is unsupported"). When `--all` is supported, "Status-all and task-count parity is guarded by test" applies instead.

The derived per-artifact status SHALL match `openspec status --json` output
artifact-for-artifact for a representative change set, enforced by an
automated test that skips gracefully when the `openspec` CLI is unavailable.

The graceful skip SHALL be reserved for a genuinely absent CLI. A parse failure
SHALL NOT reach the skip branch: the skip is indistinguishable from a pass in the
report, so a test that silently stops asserting is worse than one that fails.

The test SHALL run its per-change CLI spawns through a BOUNDED CONCURRENCY POOL
rather than sequentially, so its wall clock does not scale with the size of the
change backlog. Sequential spawns cost ~0.7s each, which crosses a 60s timeout at
~85 active changes — a cliff every repo reaches by accumulating changes, and one
unrelated to the parity being verified.

#### Scenario: Derived status equals CLI status

- **GIVEN** the `openspec` CLI is available and the repo has active changes
- **WHEN** the parity test derives status locally and via the CLI for each
  change
- **THEN** the two artifact lists are equal per change

#### Scenario: Backlog growth does not time the test out

- **GIVEN** the repo has 85 or more active changes
- **WHEN** the parity test runs under the harness's ephemeral `HOME`
- **THEN** it SHALL complete well inside its timeout by pooling the spawns
- **AND** it SHALL actually assert parity rather than take the CLI-absent skip
