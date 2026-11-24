## RENAMED Requirements

- FROM: `### Requirement: File-tree rows SHALL offer a copy-path popup`
- TO: `### Requirement: File-tree rows SHALL offer a row actions menu`

## MODIFIED Requirements

### Requirement: File-tree rows SHALL offer a row actions menu

Each file-tree rail row (both files and directories) SHALL expose a **row actions
glyph** that is hover-revealed: the glyph SHALL appear, flush-right on the row,
when the row is hovered, focused-within, or its menu is open, and SHALL be
otherwise visually unobtrusive. On devices without hover (`(hover: none)`) the
glyph SHALL be always visible. The glyph SHALL be keyboard-focusable, labelled
"Row actions", and expose `aria-haspopup="menu"` and `aria-expanded`. The menu
SHALL follow the pane menu keyboard model (see `editor-pane-chrome`).

Activating the glyph SHALL NOT open the file or expand/collapse the directory
(the glyph's activation SHALL stop propagation to the row). Activating the glyph
SHALL open a **popup menu anchored to the glyph**. The same menu SHALL also open,
anchored to the row's glyph, on a secondary click (right-click) anywhere on the
row — suppressing the browser's native context menu — and on the context-menu
key or Shift+F10 while the row is focused. Opening the menu by these means SHALL
NOT open the file or expand/collapse the directory. Escape SHALL return focus to
the control that opened the menu: the glyph, or the row when opened from the row.

The menu SHALL offer, in order:

- **Copy full path** — the row's absolute path (`cwd` joined with the row's
  path relative to `cwd`).
- **Copy relative path** — the row's path relative to the session `cwd`.
- **Copy file name** — the row's basename.
- **Download** — file rows only; SHALL save the file's on-disk bytes from
  `GET /api/file/raw` in download mode (`download=1`) using the same hybrid
  delivery as the document bar Download (see `editor-pane-chrome`). Directory
  rows SHALL NOT offer Download. The tree SHALL NOT show an unsaved-changes hint.

The menu SHALL display the target absolute path (truncated as needed) as a
header so the action target is unambiguous. When the menu would overflow the
rail's bottom edge, it SHALL render above the glyph instead of below.

Selecting a copy action SHALL copy the corresponding payload to the clipboard
using `navigator.clipboard.writeText()`, SHALL show a transient ✓ confirmation,
and SHALL then close the menu. When the Clipboard API is unavailable (e.g. a
non-secure context), the action SHALL fail silently without throwing, matching
the existing `CopyButton` behavior. Selecting Download SHALL trigger the
download and close the menu immediately.

The menu SHALL be dismissable by clicking outside it, by scrolling the rail, and
by pressing Escape.

#### Scenario: Copy glyph is hover-revealed and does not open the file
- **GIVEN** a file-tree row for `src/foo.ts`
- **WHEN** the user hovers the row
- **THEN** a row actions glyph appears flush-right on the row
- **WHEN** the user activates the glyph
- **THEN** the row actions menu opens
- **AND** `onOpenFile` is NOT invoked for `src/foo.ts`

#### Scenario: Copy full path
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user opens the row actions menu and selects **Copy full path**
- **THEN** `/Users/u/proj/src/foo.ts` SHALL be written to the clipboard
- **AND** a ✓ confirmation SHALL show and the menu SHALL close

#### Scenario: Copy relative path and file name
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `src/foo.ts`
- **WHEN** the user selects **Copy relative path**
- **THEN** `src/foo.ts` SHALL be written to the clipboard
- **WHEN** the user selects **Copy file name**
- **THEN** `foo.ts` SHALL be written to the clipboard

#### Scenario: Directory rows offer the same copy actions
- **GIVEN** a directory row for `.git`
- **WHEN** the user opens its row actions menu
- **THEN** the three copy actions are offered and no Download item is rendered
- **WHEN** the user selects **Copy full path**
- **THEN** the directory's absolute path SHALL be copied
- **AND** the directory SHALL NOT expand or collapse

#### Scenario: Download a file from the tree
- **GIVEN** a session whose cwd is `/Users/u/proj` and a row for `docs/report.pdf`
- **WHEN** the user opens the row actions menu and selects **Download**
- **THEN** a download of `/api/file/raw?cwd=%2FUsers%2Fu%2Fproj&path=docs%2Freport.pdf&download=1` is started
- **AND** the menu closes and `onOpenFile` is NOT invoked

#### Scenario: Right-click opens the same menu
- **GIVEN** a file-tree row for `src/foo.ts`
- **WHEN** the user right-clicks the row
- **THEN** the browser's native context menu is suppressed and the row actions menu opens
- **AND** `onOpenFile` is NOT invoked for `src/foo.ts`

#### Scenario: Keyboard opens the menu
- **GIVEN** the row for `src/foo.ts` has keyboard focus
- **WHEN** the user presses Shift+F10 or the context-menu key
- **THEN** the row actions menu opens

#### Scenario: Popup dismissal
- **GIVEN** an open row actions menu
- **WHEN** the user clicks outside it, or scrolls the rail, or presses Escape
- **THEN** the menu SHALL close without copying or downloading anything

#### Scenario: Clipboard unavailable
- **GIVEN** a context where `navigator.clipboard` is undefined
- **WHEN** the user selects any copy action
- **THEN** the action SHALL fail silently without throwing

#### Scenario: Glyph visible without hover
- **GIVEN** a device whose primary pointer cannot hover
- **THEN** every row's row actions glyph is visible without hovering, and tapping it opens the menu without opening the file
