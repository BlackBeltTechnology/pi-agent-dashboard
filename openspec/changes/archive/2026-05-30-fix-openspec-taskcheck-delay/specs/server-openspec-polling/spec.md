## ADDED Requirements

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
