## ADDED Requirements

### Requirement: OpenSpec Workflow Schema section

The Settings panel's Advanced tab SHALL include an "OpenSpec Workflow Schema" section, separate from the "OpenSpec Workflow Profile" section. It SHALL contain:
- a **Default for new projects** switch bound to `openspec.workflowSchema.defaultForNewProjects`. It buffers into the Settings draft and is persisted only through the unified Save (`PUT /api/config`);
- a per-cwd list showing each known cwd's `workflowSchema` status (`configured`, `generated`, `missing`, unpinned count);
- per-cwd action buttons offered by state: **Enable**, **Disable**, **Update** (for `outdated` / `missing`), **Adopt** (non-symlink `unmanaged`), **Pin…** (non-empty `unpinnedChanges`), **Remove**.

The per-cwd actions write repository files immediately via `POST /api/openspec/workflow-schema`. They are NOT Save Bar sources. Each opens a confirmation dialog listing the paths to be written and, for a worktree cwd, the branch. Update additionally states how many active changes pinned to `pi-spec-driven` it affects. Pin lets the user choose between `pi-spec-driven` and the stamp's `previousDefault` only.

#### Scenario: Default switch defers to Save

- **WHEN** the user toggles "Default for new projects"
- **THEN** the change SHALL be held in the draft and persisted only on Save

#### Scenario: Enable confirms before writing

- **WHEN** the user clicks Enable for `/repo/a`
- **THEN** a dialog SHALL list `openspec/schemas/pi-spec-driven/`, `openspec/config.yaml` and the `.openspec.yaml` files to be created
- **AND** nothing SHALL be written until the user confirms
- **AND** the Save Bar SHALL NOT appear because of this action
