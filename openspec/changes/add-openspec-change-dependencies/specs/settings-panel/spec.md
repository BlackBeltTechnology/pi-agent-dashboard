## MODIFIED Requirements

### Requirement: OpenSpec Workflow Schema section

The OpenSpec settings page (`/settings/openspec`, the page `CONFIG_FIELD_PAGE` maps the `openspec` key to) SHALL include an "OpenSpec Workflow Schema" section, separate from the "OpenSpec Workflow Profile" section. The folder-section notice chip deep-links to `/settings/openspec#workflow-schema` with the cwd preselected. It SHALL contain:
- a **Default for new projects** switch bound to `openspec.workflowSchema.defaultForNewProjects`. It buffers into the Settings draft and is persisted only through the unified Save (`PUT /api/config`);
- a per-cwd list showing each known cwd's `workflowSchema` status (`configured`, `generated`, `missing`, unpinned count);
- per-cwd action buttons offered only in the states allowed by `openspec-workflow-schema` "Actions are allowed only in defined states": **Enable**, **Disable**, **Update** (for `outdated`, or `generated: none` while configured = `pi-spec-driven`), **Adopt** (non-symlink `unmanaged`), **Pin…** (non-empty `unpinnedChanges`), **Remove**. Update, Adopt and a stamp-less Disable show a previous-default selector (preselected `spec-driven`, listing only project and package schemas).

The per-cwd actions write repository files immediately via `POST /api/openspec/workflow-schema`. They are NOT Save Bar sources. Each opens a confirmation dialog listing the paths to be written and, for a worktree cwd, the branch. Update additionally states how many active changes resolve to `pi-spec-driven` (pinned, or unpinned via the default) and are therefore affected (`workflowSchema.affectedChanges`). When the Update raises the patch to 2, it also states how many of them lack `dependencies.yaml` (`workflowSchema.undeclaredChanges`) and that those changes (including ones currently implementing or complete) return to planning until they declare dependencies. Pin lets the user choose between `pi-spec-driven` and the stamp's `previousDefault` only.

#### Scenario: Default switch defers to Save

- **WHEN** the user toggles "Default for new projects"
- **THEN** the change SHALL be held in the draft and persisted only on Save

#### Scenario: Enable confirms before writing

- **WHEN** the user clicks Enable for `/repo/a`
- **THEN** a dialog SHALL list `openspec/schemas/pi-spec-driven/`, `openspec/config.yaml` and the `.openspec.yaml` files to be created
- **AND** nothing SHALL be written until the user confirms
- **AND** the Save Bar SHALL NOT appear because of this action

#### Scenario: Update to patch 2 warns about affected changes

- **GIVEN** a patch-1 project with `affectedChanges` of 4 changes and `undeclaredChanges` of 3, one of them implementing
- **WHEN** the user opens the Update confirmation
- **THEN** it SHALL state 4 affected changes, 3 of which will need a dependencies declaration and return to planning until then
