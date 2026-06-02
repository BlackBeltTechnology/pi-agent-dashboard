## ADDED Requirements

### Requirement: Initialize button routes unconfigured directories to project-init

For a directory / worktree row whose repo declares NO worktree-init hook (worktree-init-status `hasHook: false`), the row SHALL show an "Initialize" button that, when clicked, spawns an interactive project-init session in that directory (cwd = the row's path), reusing the existing spawn-session machinery with the project-init skill pre-injected. This complements the hook-present behavior: for rows with a declared hook the gate-gated hook-run behavior applies instead.

#### Scenario: No-hook row shows Initialize routing to the skill

- **WHEN** a row's worktree-init-status is `{ hasHook: false }`
- **THEN** the row SHALL show an "Initialize" button
- **AND** clicking it SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Hook-present row is unaffected

- **WHEN** a row's worktree-init-status is `{ hasHook: true }`
- **THEN** the Initialize button SHALL follow the hook-run behavior (not the project-init skill)

#### Scenario: Project-init session is first-class

- **WHEN** the project-init session is spawned from the Initialize button
- **THEN** it SHALL appear as a normal dashboard session (visible transcript, abortable)
- **AND** SHALL NOT be a detached process
