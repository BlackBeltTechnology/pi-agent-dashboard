# kb-folder-slot — delta

## MODIFIED Requirements

### Requirement: KB source management UI

The per-folder KB settings page (opened from the folder row's `→`) SHALL let the user manage the indexed paths for that folder, AND SHALL offer a rebuild action that does not require editing the configuration. The rebuild action SHALL be enabled when the folder's server-resolved sources are non-empty — the same list the reindex job walks — and no rebuild or save is already in flight; it SHALL be disabled otherwise. Its enabled state SHALL NOT be gated on the config `origin` nor on whether the form has unsaved changes. The page SHALL NOT predict that a folder indexes nothing while that folder has resolvable sources.

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
- **WHEN** the settings page for a folder with non-empty resolved sources opens and the form has NO unsaved changes
- **THEN** a `Reindex now` action SHALL be enabled
- **AND** activating it SHALL trigger `POST /api/kb/reindex?cwd=C` without first writing the config

#### Scenario: Rebuild is offered for a folder configured outside the project
- **WHEN** the settings page opens for a folder whose config `origin` is not `project` and whose resolved sources are non-empty
- **THEN** the `Reindex now` action SHALL be present and enabled alongside the bootstrap affordances
- **AND** its availability SHALL NOT depend on the presence of a project config file

#### Scenario: Rebuild tracks the saved config, not the unsaved form
- **WHEN** the form is edited so that its source list and the folder's resolved sources disagree
- **THEN** the enabled state of `Reindex now` SHALL follow the resolved sources
- **AND** a folder with empty resolved sources SHALL NOT offer an enabled `Reindex now` merely because sources were typed into the form
- **AND** a folder with non-empty resolved sources SHALL keep an enabled `Reindex now` even when the form's source list has been emptied

#### Scenario: Rebuild is refused, with a reason, when there is nothing to index
- **WHEN** the settings page opens for a folder whose resolved sources are empty
- **THEN** the `Reindex now` action SHALL be rendered in a disabled state
- **AND** an explanation that at least one indexable source must be defined first SHALL be VISIBLE beside the action without requiring hover or focus
- **AND** the action SHALL NOT be hidden

#### Scenario: The bootstrap notice does not contradict a populated index
- **WHEN** the settings page opens for a folder with no project config file but non-empty resolved sources
- **THEN** the page SHALL NOT state that the folder indexes nothing until sources are defined
- **AND** the entry count and the notice SHALL NOT assert opposite facts on the same page

#### Scenario: An empty edited source list does not predict an empty index
- **WHEN** the settings page opens for a folder whose edited `sources[]` is empty but whose resolved sources are non-empty, such as a folder configured through legacy roots
- **THEN** the page MAY report that the source list is empty
- **AND** it SHALL NOT predict that nothing will be indexed

#### Scenario: An empty source list with nothing resolvable keeps its warning
- **WHEN** the settings page opens for a folder whose edited `sources[]` is empty AND whose resolved sources are empty
- **THEN** the page SHALL still warn that nothing will be indexed

#### Scenario: Rebuild cannot be double-submitted
- **WHEN** `Reindex now` is activated
- **THEN** it SHALL be disabled for the whole window covering the optimistic pending span and any subsequently observed `indexing` state
- **AND** it SHALL re-enable once the job settles

#### Scenario: A refused rebuild trigger is surfaced in the page
- **WHEN** the `POST /api/kb/reindex` trigger is rejected so that no job starts
- **THEN** the settings page SHALL surface that error in its error region
- **AND** the action SHALL return to an enabled state so the user can retry

#### Scenario: A user-initiated failure outranks an ambient one
- **WHEN** a rebuild trigger rejection and a stats-poll outage are both outstanding
- **THEN** the error region SHALL show the rebuild trigger rejection
- **AND** a bootstrap failure, when also outstanding, SHALL outrank the rebuild trigger rejection

#### Scenario: A sustained stats outage during a rebuild is surfaced
- **WHEN** the `/api/kb/stats` poll has failed for the consecutive-miss threshold while a rebuild is in flight and the page has settled
- **THEN** the settings page SHALL surface the outage using the same channel precedence as the folder slot, where a rejected trigger outranks a poll outage
- **AND** the surfaced text SHALL NOT be silently replaced by an idle state while the outage persists
