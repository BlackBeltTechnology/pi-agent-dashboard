## ADDED Requirements

### Requirement: Folder OpenSpec section aggregates worktree member cwds

The folder-level OpenSpec section SHALL present the union of OpenSpec changes
across the group's cwd and every member session's distinct cwd (worktree
cwds), de-duplicated by change name. The folder cwd entry SHALL win on a
change-name collision; worktree-only changes SHALL be appended. The section
SHALL render when any member cwd reports `initialized` or `pending`.

#### Scenario: Worktree-only change appears in the folder card

- **GIVEN** a group whose folder cwd `/repo` has changes A, B and a member
  worktree session at `/repo/.worktrees/feat-x` whose openspec data has change
  C (not present in `/repo`)
- **WHEN** the folder OpenSpec section renders
- **THEN** the change list shows A, B, and C
- **AND** C is marked as originating from the worktree cwd

#### Scenario: Same change name in main and worktree de-duplicates

- **GIVEN** change A exists in both `/repo` and a member worktree cwd
- **WHEN** the folder OpenSpec section renders
- **THEN** A appears exactly once, sourced from `/repo`

### Requirement: Task read and toggle target the change's source cwd

Reading and toggling a task from a change row SHALL use the cwd the change was
discovered under (`sourceCwd`), not the folder group cwd, so edits land in the
working copy the change actually lives in.

#### Scenario: Toggling a worktree-origin row writes the worktree copy

- **GIVEN** a change row whose `sourceCwd` is a worktree cwd
- **WHEN** the user ticks a task checkbox in its TasksPopover
- **THEN** the toggle request carries the worktree cwd
- **AND** the worktree's `tasks.md` is modified, not the main repo's

#### Scenario: Manual edit in worktree reflects in the folder card

- **GIVEN** a worktree session whose `tasks.md` is edited externally to mark a
  task done
- **WHEN** the server broadcasts `openspec_update` for the worktree cwd
- **THEN** the folder OpenSpec section reflects the updated task count for that
  change
