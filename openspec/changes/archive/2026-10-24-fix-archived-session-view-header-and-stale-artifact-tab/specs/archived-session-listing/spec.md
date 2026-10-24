## ADDED Requirements

### Requirement: Read-only archived view renders the session header

The read-only archived view (`/session/<id>?archived=1`, with or without
`embed=1`) SHALL render the session header from the archived summary row,
including the layout switch, and SHALL never show "No session selected". It
SHALL NOT offer rename, tag edit, seek-to-card, Resume or Fork.

#### Scenario: Header shows the archived session in embed mode
- **WHEN** the user opens `/session/<id>?archived=1&embed=1` and the summary for `<id>` has loaded
- **THEN** the header SHALL show the session name and the Chat / Split / Editor layout switch
- **AND** SHALL NOT show "No session selected"

#### Scenario: Same header outside embed mode
- **WHEN** the user opens `/session/<id>?archived=1` (or `&embed=0`) and the summary has loaded
- **THEN** the header SHALL show the session name and the layout switch

#### Scenario: Read-only header offers no mutating controls
- **WHEN** the archived header renders
- **THEN** no rename, tag editor, seek-to-card, Resume or Fork control SHALL be present

#### Scenario: Summary still loading
- **WHEN** the archived view renders before `GET /api/sessions/archived/<id>` has answered
- **THEN** the header SHALL show a loading placeholder, not "No session selected"

#### Scenario: Summary fetch fails
- **WHEN** `GET /api/sessions/archived/<id>` fails
- **THEN** the header SHALL show "Archived session unavailable", not "No session selected"

### Requirement: Read-only archived view scopes the editor pane to the archived folder

The editor pane in the read-only archived view SHALL read files relative to the
archived session's `cwd` and SHALL NOT issue `/api/file` requests with an empty
`cwd`.

#### Scenario: Restored tab reads from the archived session's folder
- **WHEN** the archived view restores an editor tab after the summary has loaded
- **THEN** `/api/file` SHALL be requested with the archived session's `cwd`

#### Scenario: Pane while the summary is loading or failed
- **WHEN** the archived view renders with a persisted editor tab before the summary has loaded, or after it failed
- **THEN** the pane SHALL show a loading (or "Archived session unavailable") notice and SHALL issue no `/api/file` request with an empty `cwd`

#### Scenario: Live sessions unaffected
- **WHEN** a live or ended (non-archived) session's pane restores a tab
- **THEN** the pane SHALL behave as before (its `cwd` is never empty)
