## MODIFIED Requirements

### Requirement: Absolute path containment on file endpoints

`/api/file` SHALL accept absolute `path` values (including decoded `file://` payloads) but MUST continue to enforce that the resolved target lies inside the containment anchors of an admitted `cwd` (see `file-read-containment`). An absolute path outside them MUST be rejected exactly as a traversal attempt is today. (The former `/api/open-editor` co-mention is REMOVED with the external editor endpoint.)

#### Scenario: absolute path inside session cwd allowed

- **GIVEN** a session cwd `/home/u/proj`
- **WHEN** `/api/file` is called with an absolute `path` resolving to `/home/u/proj/src/foo.ts`
- **THEN** the file SHALL be read and returned

#### Scenario: absolute path outside any session cwd rejected

- **GIVEN** an admitted cwd whose containment anchors do not contain `/etc`
- **WHEN** `/api/file` is called with absolute `path=/etc/passwd`
- **THEN** the request SHALL be rejected (no file content returned)
