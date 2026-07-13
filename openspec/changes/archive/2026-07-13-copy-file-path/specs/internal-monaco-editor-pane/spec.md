## ADDED Requirements

### Requirement: File-tree rows SHALL offer a copy-path popup

Each file-tree rail row (both files and directories) SHALL expose a **copy
affordance** that is hover-revealed: a copy glyph SHALL appear, flush-right on
the row, when the row is hovered or its popup is open, and SHALL be otherwise
visually unobtrusive.

Activating the copy glyph SHALL NOT open the file or expand/collapse the
directory (the glyph's activation SHALL stop propagation to the row). Activating
the glyph SHALL open a **popup menu anchored to the glyph** offering exactly
three actions:

- **Copy full path** — the row's absolute path (`cwd` joined with the row's
  path relative to `cwd`).
- **Copy relative path** — the row's path relative to the session `cwd`.
- **Copy file name** — the row's basename.

The popup SHALL display the target absolute path (truncated as needed) as a
header so the action target is unambiguous. When the popup would overflow the
rail's bottom edge, it SHALL render above the glyph instead of below.

Selecting an action SHALL copy the corresponding payload to the clipboard using
`navigator.clipboard.writeText()`, SHALL show a transient ✓ confirmation, and
SHALL then close the popup. When the Clipboard API is unavailable (e.g. a
non-secure context), the action SHALL fail silently without throwing, matching
the existing `CopyButton` behavior.

The popup SHALL be dismissable by clicking outside it, by scrolling the rail, and
by pressing Escape.

#### Scenario: Copy glyph is hover-revealed and does not open the file
- **GIVEN** a file-tree row for `src/foo.ts`
- **WHEN** the user hovers the row
- **THEN** a copy glyph appears flush-right on the row
- **WHEN** the user activates the copy glyph
- **THEN** the copy-path popup opens
- **AND** `onOpenFile` is NOT invoked for `src/foo.ts`

#### Scenario: Copy full path
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user activates the copy glyph and selects **Copy full path**
- **THEN** `/Users/u/proj/src/foo.ts` SHALL be written to the clipboard
- **AND** a ✓ confirmation SHALL show and the popup SHALL close

#### Scenario: Copy relative path and file name
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user selects **Copy relative path**
- **THEN** `src/foo.ts` SHALL be written to the clipboard
- **WHEN** the user selects **Copy file name**
- **THEN** `foo.ts` SHALL be written to the clipboard

#### Scenario: Directory rows offer the same copy actions
- **GIVEN** a directory row for `.git`
- **WHEN** the user activates its copy glyph and selects **Copy full path**
- **THEN** the directory's absolute path SHALL be copied
- **AND** the directory SHALL NOT expand or collapse

#### Scenario: Popup dismissal
- **GIVEN** an open copy-path popup
- **WHEN** the user clicks outside it, or scrolls the rail, or presses Escape
- **THEN** the popup SHALL close without copying anything

#### Scenario: Clipboard unavailable
- **GIVEN** a context where `navigator.clipboard` is undefined
- **WHEN** the user selects any copy action
- **THEN** the action SHALL fail silently without throwing
