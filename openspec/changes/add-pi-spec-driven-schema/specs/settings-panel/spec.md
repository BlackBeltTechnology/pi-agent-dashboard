## ADDED Requirements

### Requirement: OpenSpec Workflow Schema section

The OpenSpec settings page (`/settings/openspec`, the page `CONFIG_FIELD_PAGE` maps the `openspec` key to) SHALL include an "OpenSpec Workflow Schema" section, separate from the "OpenSpec Workflow Profile" section. The folder-section notice chip deep-links to `/settings/openspec#workflow-schema` with the cwd preselected. It SHALL contain:
- a **Default for new projects** switch bound to `openspec.workflowSchema.defaultForNewProjects`. It buffers into the Settings draft and is persisted only through the unified Save (`PUT /api/config`);
- a per-cwd list showing each known cwd's `workflowSchema` status (`configured`, `generated`, `missing`, unpinned count);
- per-cwd action buttons offered only in the states allowed by `openspec-workflow-schema` "Actions are allowed only in defined states": **Enable**, **Disable**, **Update** (for `outdated`, or `generated: none` while configured = `pi-spec-driven`), **Adopt** (non-symlink `unmanaged`), **Pin…** (non-empty `unpinnedChanges`), **Remove**. Update, Adopt and a stamp-less Disable show a previous-default selector (preselected `spec-driven`, listing only project and package schemas).

The per-cwd actions write repository files immediately via `POST /api/openspec/workflow-schema`. They are NOT Save Bar sources. Each opens a confirmation dialog listing the paths to be written and, for a worktree cwd, the branch. Update additionally states how many active changes resolve to `pi-spec-driven` (pinned, or unpinned via the default) and are therefore affected (`workflowSchema.affectedChanges`). Pin lets the user choose between `pi-spec-driven` and the stamp's `previousDefault` only.

#### Scenario: Default switch defers to Save

- **WHEN** the user toggles "Default for new projects"
- **THEN** the change SHALL be held in the draft and persisted only on Save

#### Scenario: Enable confirms before writing

- **WHEN** the user clicks Enable for `/repo/a`
- **THEN** a dialog SHALL list `openspec/schemas/pi-spec-driven/`, `openspec/config.yaml` and the `.openspec.yaml` files to be created
- **AND** nothing SHALL be written until the user confirms
- **AND** the Save Bar SHALL NOT appear because of this action

## MODIFIED Requirements

### Requirement: Settings Save Bar

Provider credentials, custom provider endpoints, every action on the Services and Runtimes pages, and the per-cwd OpenSpec Workflow Schema actions are NOT a Save Bar source: they commit on their own action at the point of edit and SHALL NOT contribute a draft, a baseline, or an unsaved-changes count.

The panel SHALL render a Save Bar that is present only when the draft is dirty (any source's draft differs from its baseline) and absent when the draft is clean. The Save Bar SHALL display the count of unsaved changes, a **Discard** action, and a **Save** action. The Save action SHALL always be interactive while the bar is visible (the bar's presence is the dirty signal; the Save control is never shown disabled-because-clean). The Save Bar SHALL reflect four states: **dirty** (idle, awaiting save), **saving** (in flight), **saved** (success — the bar dismisses as the draft re-baselines clean), and **error** (one or more sources failed — Retry offered).

The Save Bar SHALL additionally name every page that holds unsaved edits. Each named page SHALL be an affordance that navigates to that page. Saving remains a single global fan-out across all dirty sources regardless of page; the naming is attribution only and SHALL NOT introduce per-page commit semantics.

#### Scenario: Bar hidden when clean
- **WHEN** the user opens Settings and makes no edits
- **THEN** no Save Bar SHALL be shown
- **AND** no unsaved-changes prompt SHALL fire on navigation

#### Scenario: A provider write does not open the Save Bar
- **WHEN** the user adds, edits, or removes a provider credential or a custom endpoint
- **THEN** the write SHALL commit on its own action
- **AND** the Save Bar SHALL NOT appear on account of that write

#### Scenario: The Providers page keeps its dirty attribution for other sources
- **WHEN** the user edits an API-Proxy control, whose config key is attributed to the Providers page
- **THEN** the Save Bar SHALL appear naming the Providers page
- **AND** the navigation guard SHALL still fire for that edit

#### Scenario: Bar appears on first edit
- **WHEN** the user changes any setting from its loaded value
- **THEN** the Save Bar SHALL appear showing the unsaved-changes count, Discard, and Save

#### Scenario: Discard reverts to baseline
- **WHEN** the user clicks Discard in the Save Bar
- **THEN** every source's draft SHALL reset to its baseline
- **AND** the Save Bar SHALL disappear

#### Scenario: Saving and saved states
- **WHEN** the user clicks Save with dirty sources
- **THEN** the Save Bar SHALL show a saving state while requests are in flight
- **AND** on full success SHALL re-baseline all committed sources and dismiss

#### Scenario: Error state offers retry
- **WHEN** Save completes with at least one failed source
- **THEN** the Save Bar SHALL remain visible in an error state with a Retry action
- **AND** the unsaved-changes count SHALL reflect only the still-dirty sources

#### Scenario: Bar names every dirty page
- **WHEN** the user has unsaved edits on the Server page and then, without saving, opens `/settings/plugins/goal` and edits a control there
- **THEN** the Save Bar SHALL name both pages
- **AND** clicking the `Plugins › Goal` name SHALL navigate to `/settings/plugins/goal`

#### Scenario: One Save commits every page
- **WHEN** the Save Bar names two pages and the user clicks Save
- **THEN** a single fan-out SHALL commit the dirty sources of both pages
- **AND** both pages' dirty indicators SHALL clear

#### Scenario: Service actions do not dirty the draft
- **WHEN** the user stops a service and saves a secret value on the Services pages
- **THEN** the Save Bar SHALL stay absent and the unsaved-changes count SHALL be unchanged
