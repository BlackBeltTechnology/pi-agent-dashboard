# open-in-editor Specification

## Purpose
File-open entry points route exclusively to the internal Monaco editor pane. The external/native editor launcher is removed.
## Requirements
### Requirement: OpenFileButton SHALL open the internal pane only

`OpenFileButton` SHALL render as a plain "Open" control. A click SHALL open the file in the internal Monaco editor pane — via `openInSplit(filePath, line?)` when a split-workspace context is present for the session, else via `buildEditorUrl(sessionId, filePath, line?)` route navigation. The native-editor caret dropdown is REMOVED; the button SHALL NOT reference detected editors and SHALL NOT invoke any external/native editor launch.

The button SHALL render whenever a resolvable `cwd` and a `filePath` are present, on every tool-card renderer that renders it today. It SHALL NOT render when the tool call has no resolvable cwd or no file path.

#### Scenario: Click opens internal pane (split context present)

- **GIVEN** a session with an active split-workspace context
- **WHEN** the user clicks the `OpenFileButton` for `src/foo.ts`
- **THEN** `src/foo.ts` SHALL open/activate as a tab in the internal pane
- **AND** no external or native editor SHALL be launched

#### Scenario: Click opens internal pane (no split context)

- **GIVEN** a tool card outside a split-workspace context
- **WHEN** the user clicks the `OpenFileButton` for `src/foo.ts` at line 42
- **THEN** the URL SHALL navigate to the internal editor route for `src/foo.ts` scrolled to line 42

### Requirement: Absolute path containment on file endpoints

`/api/file` SHALL accept absolute `path` values (including decoded `file://` payloads) but MUST continue to enforce that the resolved target lies under a known session cwd. An absolute path outside every session cwd MUST be rejected exactly as a traversal attempt is today. (The former `/api/open-editor` co-mention is REMOVED with the external editor endpoint.)

#### Scenario: absolute path inside session cwd allowed

- **GIVEN** a session cwd `/home/u/proj`
- **WHEN** `/api/file` is called with an absolute `path` resolving to `/home/u/proj/src/foo.ts`
- **THEN** the file SHALL be read and returned

#### Scenario: absolute path outside any session cwd rejected

- **GIVEN** session cwds that do not contain `/etc`
- **WHEN** `/api/file` is called with absolute `path=/etc/passwd`
- **THEN** the request SHALL be rejected (no file content returned)
