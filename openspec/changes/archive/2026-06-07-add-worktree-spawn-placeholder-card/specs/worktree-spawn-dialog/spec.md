## ADDED Requirements

### Requirement: Dialog signals spawn lifecycle for placeholder feedback
`WorktreeSpawnDialog` SHALL accept optional callbacks `onSpawnStart?(parentCwd: string)` and `onSpawnAbort?(parentCwd: string)` so the host can render a placeholder card from the moment of submit and remove it on early failure. `parentCwd` SHALL be the dialog's `cwd` prop (the parent repo group cwd), so the placeholder renders in the group that will host the new worktree session.

The dialog SHALL invoke `onSpawnStart(cwd)` at the START of every submit path — both the existing-worktree one-click `Spawn →` row and the create-new submit — BEFORE issuing any `createWorktree` or spawn call. The dialog SHALL invoke `onSpawnAbort(cwd)` when `createWorktree` rejects or returns a non-ok result, and SHALL keep the dialog open displaying the error. On success the dialog SHALL proceed to its existing `onSpawn(path, opts)` call; the host clears the placeholder later via the normal `session_added` / `spawn_result` flow keyed on `placeholderCwd`.

Both callbacks SHALL be optional; when absent the dialog SHALL behave exactly as before (back-compat).

#### Scenario: onSpawnStart fires at submit before createWorktree
- **WHEN** the user clicks "Spawn →" to create a new worktree
- **THEN** the dialog SHALL call `onSpawnStart(cwd)` before the `createWorktree` request is sent
- **AND** the host SHALL render a placeholder in the `cwd` group immediately, covering the `createWorktree` latency window

#### Scenario: onSpawnStart fires for existing-worktree spawn
- **WHEN** the user clicks `Spawn →` on an existing-worktree row
- **THEN** the dialog SHALL call `onSpawnStart(cwd)` before invoking `onSpawn(entry.path, …)`

#### Scenario: onSpawnAbort fires when createWorktree fails
- **WHEN** `createWorktree` rejects with a stable error code (e.g. `branch_in_use`, `path_exists`, `base_not_found`)
- **THEN** the dialog SHALL call `onSpawnAbort(cwd)`
- **AND** the dialog SHALL remain open rendering the error
- **AND** the host SHALL remove the placeholder immediately rather than waiting for the safety timeout

#### Scenario: Successful create proceeds to onSpawn
- **WHEN** `createWorktree` succeeds and returns `res.path`
- **THEN** the dialog SHALL NOT call `onSpawnAbort`
- **AND** the dialog SHALL call `onSpawn(res.path, opts)` as today, leaving the placeholder in place until `session_added` clears it

#### Scenario: Callbacks optional (back-compat)
- **WHEN** the dialog is mounted without `onSpawnStart` / `onSpawnAbort`
- **THEN** submit and failure paths SHALL behave exactly as before, with no placeholder lifecycle signals
