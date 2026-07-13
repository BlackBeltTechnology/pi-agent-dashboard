## MODIFIED Requirements

### Requirement: Initialize button routes unconfigured directories to project-init

For a directory / worktree row whose worktree-init-status reports `{ hasHook: false, configured: false }` (no declared hook AND not yet a configured pi project), the row SHALL show a "Set up project" button, rendered by a dedicated `ProjectInitButton` component distinct from the hook-run `WorktreeInitButton`. The `ProjectInitButton` SHALL carry its own label ("Set up project"), icon, and neutral/primary color — visually distinct from the amber, repo-code-executing hook-run control — so the scaffold action and the hook-run action are never confusable. Clicking it SHALL spawn an interactive project-init session in that directory (cwd = the row's path), reusing the existing spawn-session machinery with the project-init skill pre-injected.

For a row reporting `{ hasHook: false, configured: true }` (already a configured pi project that declares no worktree-init hook), the row SHALL render NO initialize control of either kind — there is nothing to initialize.

For a row reporting `{ hasHook: true }`, the hook-run behavior applies (governed by "Initialize button gated on worktree-init status"), NOT the project-init scaffold.

#### Scenario: Unconfigured row shows Set up project routing to the skill

- **WHEN** a row's worktree-init-status is `{ hasHook: false, configured: false }`
- **THEN** the row SHALL show a "Set up project" button rendered by `ProjectInitButton`
- **AND** the button SHALL be visually distinct (label, icon, color) from the hook-run Initialize control
- **AND** clicking it SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Configured-but-hookless row shows nothing

- **WHEN** a row's worktree-init-status is `{ hasHook: false, configured: true }`
- **THEN** the row SHALL NOT show a "Set up project" button
- **AND** the row SHALL NOT show a hook-run Initialize button

#### Scenario: Hook-present row is unaffected

- **WHEN** a row's worktree-init-status is `{ hasHook: true }`
- **THEN** the initialize control SHALL follow the hook-run behavior (not the project-init scaffold)

#### Scenario: Project-init session is first-class

- **WHEN** the project-init session is spawned from the `ProjectInitButton`
- **THEN** it SHALL appear as a normal dashboard session (visible transcript, abortable)
- **AND** SHALL NOT be a detached process
