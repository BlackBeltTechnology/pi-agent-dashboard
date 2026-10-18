## MODIFIED Requirements

### Requirement: Poll paths use one `openspec status --all` spawn per directory

When the resolved CLI supports it, both the periodic / gated poll path (`force === false`) and the user-initiated force-refresh path (`force === true`) SHALL obtain per-change artifact status, `isComplete`, `schemaName` and `artifactPaths` from a single `openspec status --all --json` invocation per directory, through the spawn-concurrency semaphore, with a timeout of 30 s. The server SHALL NOT spawn `openspec list` or per-change `openspec status --change <name>` on either path while `--all` is supported.

The existing pre-spawn short-circuit SHALL be retained: when `<cwd>/openspec/changes/` does not exist, no CLI SHALL be spawned and the directory SHALL resolve to `initialized: false` (readiness `missing-changes-dir`).

The CLI verdict SHALL be the artifact status source for every schema; the existing promote-only specs evidence override SHALL still apply on top of it, and the design evidence override SHALL apply to every change except those whose `schemaName` is `pi-spec-driven`. `OpenSpecChange.artifacts` SHALL be emitted in canonical order — `proposal`, `design`, `specs`, `tasks` (those present) — followed by any other artifact ids in CLI order, on both the gated and the force path (previously the force path broadcast the CLI's `proposal, specs, design, tasks` order while the gated path used canonical order). `OpenSpecData.changes` SHALL be ordered by the probe's per-change effective mtime, newest first, ties by name; the probe SHALL enumerate `changes/*` directories itself (excluding `archive/`), so every change — including one created since the last poll and every change on a cold cache — has a probe mtime. (This approximates, but does not reproduce, `openspec list`'s recursive-mtime order; clients that re-sort are unaffected.) The transitional `pending` broadcast SHALL be emitted before the tracked-path probe is dispatched.

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
