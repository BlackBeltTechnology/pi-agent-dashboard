## ADDED Requirements

### Requirement: Missing artifact of an archived change offers the archived copy

In any session's editor pane, when a tab's existence probe returns 404 for
`openspec/changes/<name>/<rest>` (not under `archive/`) and the folder's
OpenSpec archive holds `<YYYY-MM-DD>-<name>`, the pane SHALL keep the
`File no longer exists: <path>` message and SHALL add the archived directory
name with an **Open archived copy** control.

#### Scenario: Stale proposal tab after archiving
- **GIVEN** a tab for `openspec/changes/add-x/proposal.md` and archive entry `2026-10-22-add-x`
- **WHEN** the file probe returns 404
- **THEN** the pane SHALL show `File no longer exists: openspec/changes/add-x/proposal.md`, the name `2026-10-22-add-x` and **Open archived copy**
- **AND** activating it SHALL leave exactly one tab, `openspec/changes/archive/2026-10-22-add-x/proposal.md`, rendering its content

#### Scenario: Newest same-name archive wins
- **WHEN** the archive holds `2026-01-02-add-x` and `2026-03-04-add-x`
- **THEN** the archived copy SHALL resolve under `2026-03-04-add-x`

#### Scenario: No archive entry, listing pending, or listing failed
- **WHEN** the probe returns 404 and the archive has no exact `<name>` match, is still loading, or failed to load
- **THEN** the pane SHALL show only `File no longer exists: <path>`

#### Scenario: Other missing files never read the archive
- **WHEN** the probe returns 404 for a path outside `openspec/changes/<name>/` or under `openspec/changes/archive/`
- **THEN** the pane SHALL show only `File no longer exists: <path>` and SHALL NOT request the archive listing

#### Scenario: Archived copy already open
- **GIVEN** the archived copy is already open in another tab
- **WHEN** the user activates **Open archived copy** on the stale tab
- **THEN** the existing archived tab SHALL be focused and the stale tab closed, leaving one tab for that file

#### Scenario: Archived copy itself missing
- **WHEN** the archived target path also returns 404
- **THEN** its tab SHALL show only `File no longer exists: <archived path>`
