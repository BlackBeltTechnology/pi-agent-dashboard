## ADDED Requirements

### Requirement: Per-change worktree spawn button
Each change row in `FolderOpenSpecSection` SHALL render an optional `⑂+` icon button (mdiSourceBranchPlus) immediately to the left of the existing `▶` spawn-attached button. The button SHALL be visible only when ALL of the following hold:

- the folder is a git repository (`isGitRepo === true`),
- the global config flag `gitWorktreeEnabled` is `true` (default `true`),
- the parent passes an `onSpawnAttachedWorktree` handler.

Click SHALL invoke `onSpawnAttachedWorktree(cwd, changeName)`. The parent SHALL respond by opening `WorktreeSpawnDialog` scoped to the folder cwd, with `initialBranch = "os/<changeName>"` and `attachProposal = changeName` prefilled, so the resulting spawn carries both the new worktree path and the OpenSpec attachment intent.

The existing `▶` spawn-attached button is unchanged.

#### Scenario: Button visible on git folder with flag enabled
- **WHEN** a folder row is rendered for a git repo, `gitWorktreeEnabled` is true, and `onSpawnAttachedWorktree` is wired
- **THEN** the `⑂+` button SHALL render between the artifact-letters group and the `▶` button
- **THEN** its tooltip SHALL read `New worktree for this change`

#### Scenario: Button hidden when flag disabled
- **WHEN** `gitWorktreeEnabled` is `false`
- **THEN** the `⑂+` button SHALL NOT render for any change row, even on git folders

#### Scenario: Button hidden on non-git folder
- **WHEN** `isGitRepo` is `false` or `undefined`
- **THEN** the `⑂+` button SHALL NOT render

#### Scenario: Click forwards cwd and change name
- **WHEN** the user clicks the `⑂+` button for change `add-dark-mode` on folder `/project/foo`
- **THEN** `onSpawnAttachedWorktree("/project/foo", "add-dark-mode")` SHALL be called exactly once
- **THEN** event propagation SHALL be stopped so the surrounding row click does not also fire
