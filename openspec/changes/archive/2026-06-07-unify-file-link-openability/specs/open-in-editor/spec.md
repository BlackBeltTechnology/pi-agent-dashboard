## ADDED Requirements

### Requirement: OpenFileButton preview fallback when no editor

`OpenFileButton` (used by Read/Edit/Write tool-call headers) SHALL route clicks identically to `FileLink`: when the dashboard is on localhost AND an editor is detected, it opens the file in the editor; otherwise it opens the in-dashboard `FilePreviewOverlay`. It MUST NOT render nothing (return `null`) merely because no editor is detected; it renders nothing only when there is no `cwd` or no `filePath`.

#### Scenario: localhost with editor
- **GIVEN** the dashboard is on localhost and an editor is detected
- **WHEN** the user activates the Read tool header's open affordance for `path="src/foo.ts"`
- **THEN** the client SHALL `POST /api/open-editor` targeting `src/foo.ts`

#### Scenario: no editor detected falls back to preview
- **GIVEN** `ToolContext.editors` is empty (or the dashboard is non-localhost)
- **WHEN** the user activates the open affordance on a Read/Edit/Write tool header
- **THEN** the in-dashboard preview overlay SHALL open for that file
- **AND** no `POST /api/open-editor` request SHALL be made

#### Scenario: no cwd renders nothing
- **GIVEN** `ToolContext.cwd` is undefined
- **WHEN** a Read/Edit/Write tool header renders
- **THEN** no open affordance SHALL render

### Requirement: Absolute path containment on file endpoints

`/api/file` and `/api/open-editor` SHALL accept absolute `path`/`file` values (including decoded `file://` payloads) but MUST continue to enforce that the resolved target lies under a known session cwd. An absolute path outside every session cwd MUST be rejected exactly as a traversal attempt is today.

#### Scenario: absolute path inside session cwd allowed
- **GIVEN** a session cwd `/home/u/proj`
- **WHEN** `/api/file` is called with an absolute `path` resolving to `/home/u/proj/src/foo.ts`
- **THEN** the file SHALL be read and returned

#### Scenario: absolute path outside any session cwd rejected
- **GIVEN** session cwds that do not contain `/etc`
- **WHEN** `/api/file` is called with absolute `path=/etc/passwd`
- **THEN** the request SHALL be rejected (no file content returned)
