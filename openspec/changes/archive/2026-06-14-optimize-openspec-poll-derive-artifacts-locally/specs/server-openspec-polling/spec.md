## ADDED Requirements

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
