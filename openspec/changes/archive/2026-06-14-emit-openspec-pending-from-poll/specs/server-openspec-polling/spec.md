## ADDED Requirements

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
