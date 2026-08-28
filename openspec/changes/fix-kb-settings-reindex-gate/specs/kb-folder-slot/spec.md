# kb-folder-slot — delta

## MODIFIED Requirements

### Requirement: KB source management UI

The per-folder KB settings page (opened from the folder row's `→`) SHALL let the user manage the indexed paths for that folder, AND SHALL offer a rebuild action that does not require editing the configuration. The rebuild action SHALL be reachable for every config `origin` whose resolved `sources[]` is non-empty, and SHALL NOT be gated on whether the form has unsaved changes.

#### Scenario: List current sources
- **WHEN** the KB settings page for folder `C` opens
- **THEN** it lists each `source` (ref, priority) plus the `include`/`exclude` globs and `dbPath`
- **AND** it shows the config `origin` and live entry count

#### Scenario: Add and save a source
- **WHEN** the user adds a source path and activates `Save + Reindex`
- **THEN** the client calls `PUT /api/kb/config?cwd=C` with the updated `sources`
- **AND** a reindex is triggered so the new path is indexed

#### Scenario: Worktree bootstrap affordances
- **WHEN** the settings page for a folder with no project file opens
- **THEN** it offers `Create project config` and `Copy from parent repo`
- **AND** `Copy from parent repo` seeds `sources[]` from the parent, rewritten relative to the folder cwd

#### Scenario: Rebuild an unchanged configuration
- **WHEN** the settings page for a folder with non-empty `sources[]` opens and the form has NO unsaved changes
- **THEN** a `Reindex now` action SHALL be enabled
- **AND** activating it SHALL trigger `POST /api/kb/reindex?cwd=C` without first writing the config

#### Scenario: Rebuild is offered regardless of config origin
- **WHEN** the settings page opens for a folder whose config `origin` is `global` or `defaults` and whose resolved `sources[]` is non-empty
- **THEN** the `Reindex now` action SHALL be present and enabled
- **AND** its availability SHALL NOT depend on the presence of a project config file

#### Scenario: Rebuild is refused, with a reason, when there is nothing to index
- **WHEN** the settings page opens for a folder whose resolved `sources[]` is empty
- **THEN** the `Reindex now` action SHALL be rendered in a disabled state
- **AND** it SHALL carry an explanation that at least one source must be defined first
- **AND** it SHALL NOT be hidden

#### Scenario: Rebuild cannot be double-submitted
- **WHEN** `Reindex now` is activated
- **THEN** it SHALL be disabled for the whole window covering the optimistic pending span and any subsequently observed `indexing` state
- **AND** it SHALL re-enable once the job settles

#### Scenario: A refused rebuild trigger is surfaced in the page
- **WHEN** the `POST /api/kb/reindex` trigger is rejected so that no job starts
- **THEN** the settings page SHALL surface that error
- **AND** the action SHALL return to an enabled state so the user can retry
