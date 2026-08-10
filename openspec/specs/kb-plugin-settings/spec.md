# kb-plugin-settings Specification

## Purpose

Per-folder Knowledge Base configuration surface. Lets a user view and edit a folder's KB path settings — indexed `sources`, `include`/`exclude` globs, and `dbPath` — showing where the effective config originates (project / global / defaults) and a live index count. Worktrees or folders without a project config get bootstrap affordances (create a fresh config or copy the parent repo's). All writes persist through the guarded KB config endpoint/action.

## Requirements

### Requirement: Load and display folder KB config

The panel SHALL fetch the effective KB config for a folder and display its origin and current index count.

#### Scenario: Fetch config on open

- **WHEN** the panel mounts for a folder `cwd`
- **THEN** it issues `GET /api/kb/config?cwd=<cwd>`
- **AND** the response provides `{ config, origin, projectPath }` with `origin` one of `"project"`, `"global"`, or `"defaults"`

#### Scenario: Origin badge and count

- **WHEN** the config has loaded
- **THEN** the origin badge (`data-testid="kb-config-origin"`) shows the `origin` value, styled distinctly for `"project"` versus a non-project origin
- **AND** the count (`data-testid="kb-config-count"`) shows chunks and files when indexed, or a not-indexed label otherwise
- **AND** when `origin === "project"` the `projectPath` is shown

#### Scenario: Loading and load-error states

- **WHEN** the config request is in flight and no editable state exists yet
- **THEN** a loading placeholder is shown
- **AND** if the request fails, the error message is shown instead

### Requirement: Edit path fields

The panel SHALL let the user edit only the v1 path fields — `sources`, `include`, `exclude`, `dbPath` — while all other config fields round-trip unchanged.

#### Scenario: Manage sources

- **WHEN** the user adds a source ref, removes a source, reorders a source up/down, or changes a source priority
- **THEN** the edited `sources` list reflects the change, each source carrying `kind`, `ref`, and `priority`
- **AND** a source `ref` already present is not added again

#### Scenario: Manage include/exclude globs

- **WHEN** the user adds or removes an entry in the include or exclude chip list
- **THEN** the corresponding `include` or `exclude` string array is updated
- **AND** a duplicate glob is not added

#### Scenario: Edit db path

- **WHEN** the user edits the DB path field
- **THEN** `dbPath` in the editable state is updated

#### Scenario: Dirty tracking

- **WHEN** the editable state differs from the loaded config baseline
- **THEN** the panel reports unsaved changes and enables the save actions; otherwise it reports no changes and disables them

### Requirement: Persist config edits

The panel SHALL persist edited path fields by writing the patch to the folder's KB config, merging over the existing on-disk config and validating before write.

#### Scenario: Save via PUT

- **WHEN** the user saves
- **THEN** the panel issues `PUT /api/kb/config?cwd=<cwd>` with a body containing `sources`, `include`, `exclude`, `dbPath`, and optionally `reindex`
- **AND** the server merges those fields over the current project config, preserving untouched fields
- **AND** on success the server returns `{ config, origin, projectPath }` and the panel updates its state from it

#### Scenario: Save and reindex

- **WHEN** the user chooses the save-and-reindex action
- **THEN** the request includes `reindex: true`
- **AND** the server kicks a reindex after the successful write while the client polls stats for completion

#### Scenario: Validation failure

- **WHEN** the merged config fails validation, or the existing on-disk config is not valid JSON
- **THEN** the server responds `400 { error }` and writes nothing
- **AND** the panel surfaces the error message

#### Scenario: Config mutation via plugin action

- **WHEN** a `config.set` plugin action arrives for `pluginId === "kb"` with an object `patch` payload
- **THEN** the server applies the same merge-validate-persist path used by the PUT route
- **AND** rejects the action if `patch` is missing, non-object, or an array, or if validation fails

### Requirement: Bootstrap a config for folders without a project file

When the effective origin is not `"project"`, the panel SHALL offer to create a new project config or copy the parent repo's config, instead of the normal save actions.

#### Scenario: Non-project bootstrap affordances

- **WHEN** `origin !== "project"`
- **THEN** the panel shows a bootstrap note that the folder indexes nothing until sources are defined
- **AND** shows "Create project config" and "Copy from parent repo" actions in place of the save/save-and-reindex actions

#### Scenario: Create project config

- **WHEN** the user chooses "Create project config"
- **THEN** the panel saves the current editable fields as a new project config (without reindex)

#### Scenario: Copy from parent repo

- **WHEN** the user chooses "Copy from parent repo" for a folder under a `.worktrees/` or `worktrees/` path
- **THEN** the panel fetches the parent repo's config via `GET /api/kb/config`, seeds `sources`/`include`/`exclude` from it, and saves with `reindex: true`
- **AND** if the parent repo cannot be detected from the folder path, a bootstrap error is shown and no save occurs

### Requirement: Guard config access by known folder

The KB config endpoints and the `config.set` action SHALL only operate on a `cwd` that is a known folder (a live session cwd or pinned dir), or a git worktree whose main repo is a known folder.

#### Scenario: Missing or disallowed cwd

- **WHEN** a config request omits `cwd`
- **THEN** the server responds `400 { error }`
- **AND** when `cwd` is present but not an allowed folder, the server responds `403 { error }`

#### Scenario: Worktree admitted via main repo

- **WHEN** `cwd` is a git worktree whose main working tree is a known folder
- **THEN** the config request is allowed even if no live session or pin covers the worktree directly
