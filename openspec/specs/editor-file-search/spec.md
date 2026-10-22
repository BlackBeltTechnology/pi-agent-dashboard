# editor-file-search Specification

## Purpose
TBD - created by archiving change split-editor-workspace. Update Purpose after archive.

## Requirements

### Requirement: Editor pane SHALL host a dual-mode search panel

The editor pane SHALL provide a search panel with two modes:
- **Filenames:** searches file paths under the session `cwd`.
- **Contents:** greps across file bodies.

The active mode SHALL be switchable in the panel. Each mode SHALL support a type-ahead query with a **substring** matcher and an optional **regexp** matcher toggled in the panel.

The panel SHALL be hosted as the **Search view of the file rail**, selected through a Files | Search switch in the rail header. It SHALL NOT render over the viewer column, and opening it SHALL leave the active document visible. Cmd/Ctrl-P SHALL open the Search view in Filenames mode and Cmd/Ctrl-Shift-F in Contents mode. When the view is already open, the shortcut for the current mode SHALL close it and the shortcut for the other mode SHALL switch to that mode. The rail switch's Search tab SHALL carry `data-testid="editor-search-toggle"`. Panes without file search (see `folder-scoped-editor-pane`) SHALL NOT offer the Search view or the shortcuts.

When the rail is collapsed, opening the Search view SHALL show the rail for as long as the view is open, without changing the persisted rail-visibility preference. While the view is open:
- choosing the rail switch's Files tab SHALL show the Files view and keep the rail visible, recording "visible" as the user's rail preference;
- turning the pane bar's Files toggle off SHALL close the Search view and hide the rail;
- another reveal of the rail (such as the Changed files chip) SHALL record "visible" as the preference as it does today.

Leaving the Search view by Escape or a shortcut SHALL then show the rail exactly when the persisted preference is "visible".

Both modes SHALL require a minimum query length (default 3 characters) before issuing a search, and SHALL debounce input. Below the minimum, the panel SHALL show a "type ≥ N chars" hint and issue no request.

#### Scenario: Filename mode ranks path matches
- **GIVEN** the search panel is in Filenames mode
- **WHEN** the user types `edit` (≥ 3 chars)
- **THEN** the panel lists files whose path matches, highest-ranked first
- **AND** each result shows its path relative to the session `cwd`

#### Scenario: Content mode greps file bodies
- **GIVEN** the search panel is in Contents mode
- **WHEN** the user types `MAX_VISITS`
- **THEN** the panel lists content matches with `path`, line number, and a snippet
- **AND** the matched substring is highlighted in the snippet

#### Scenario: Regexp toggle switches the matcher
- **GIVEN** the regexp toggle is on in Contents mode
- **WHEN** the user types `MAX_[A-Z]+`
- **THEN** matches are computed by regular expression, not literal substring

#### Scenario: Below minimum length issues no search
- **WHEN** the user types `ma` (2 chars) in either mode
- **THEN** no search request is issued
- **AND** the panel shows a "type ≥ 3 chars" hint

#### Scenario: Search opens in the rail beside the document
- **GIVEN** a PDF tab is active and the rail shows the Files view
- **WHEN** the user presses Cmd/Ctrl-Shift-F
- **THEN** the rail shows the Search view in Contents mode with focus in the query field
- **AND** the PDF remains fully visible in the viewer column

#### Scenario: Other-mode shortcut switches mode
- **GIVEN** the Search view is open in Filenames mode
- **WHEN** the user presses Cmd/Ctrl-Shift-F
- **THEN** the Search view stays open and switches to Contents mode
- **AND** pressing Cmd/Ctrl-Shift-F again closes it

#### Scenario: Files toggle while search revealed the rail
- **GIVEN** the rail was collapsed and search revealed it, so the Files toggle reads as pressed
- **WHEN** the user activates the Files toggle
- **THEN** the Search view closes, the rail hides, and the rail stays collapsed after a reload

#### Scenario: Files tab keeps a search-revealed rail open
- **GIVEN** the rail was collapsed and search revealed it
- **WHEN** the user chooses the Files tab of the rail switch
- **THEN** the rail shows the file tree and stays visible after a reload

#### Scenario: Changes reveal during search survives closing search
- **GIVEN** the rail was collapsed and search revealed it
- **WHEN** the Changed files chip reveals the rail and the user then presses Escape in the Search view
- **THEN** the rail stays visible in its Files view

#### Scenario: Search on a collapsed rail does not change the rail preference
- **GIVEN** the rail is collapsed and its collapsed state is persisted
- **WHEN** the user presses Cmd/Ctrl-P and then Escape
- **THEN** the rail is shown in Search view while searching and collapsed again after Escape
- **AND** after a reload the rail is still collapsed

### Requirement: Search results SHALL be keyboard navigable and open on select

The result list SHALL be navigable with `↑`/`↓`, open the selected result with `Enter`, and close the Search view with `Escape` while focus is inside the rail; `Escape` pressed elsewhere (for example in the viewer after a result was opened) SHALL NOT close the Search view.

Selecting a result SHALL:
- open the file in the editor pane, auto-opening the split if it is closed;
- activate the file's tab;
- for content matches, scroll to the matched line.

Selecting a result SHALL keep the Search view open so further results can be opened. Each entry into the Search view (shortcut, Open file…, Search tabs fall-through) SHALL focus its query field, replacing the query when the entry supplies one. Switching to another session SHALL return the rail to its Files view and clear the query.

Closing the Search view SHALL:
- switch the rail back to its Files view;
- show the rail exactly when the persisted rail preference is "visible";
- return focus to the active viewer.

#### Scenario: Enter opens the highlighted result
- **GIVEN** the result list has three entries with the first highlighted
- **WHEN** the user presses `↓` then `Enter`
- **THEN** the second result's file opens as the active tab in the pane

#### Scenario: Content match scrolls to the line
- **WHEN** the user opens a Contents-mode result at line 80
- **THEN** the file opens and the viewer scrolls so line 80 is visible

#### Scenario: Escape in the viewer leaves search open
- **GIVEN** the user opened a result and focus is in the viewer
- **WHEN** the user presses `Escape`
- **THEN** the Search view stays open

#### Scenario: Escape closes the panel
- **WHEN** the Search view is open, focus is inside the rail, and the user presses `Escape`
- **THEN** the rail returns to its Files view, or collapses when the persisted preference is collapsed, and focus returns to the active viewer

### Requirement: Server SHALL provide a content-search endpoint

The server SHALL expose `GET /api/grep?cwd=<cwd>&q=<query>&regex=<bool>` returning
ranked content matches `{ path, line, col, snippet }[]`. The endpoint SHALL prefer
`ripgrep` (`rg`) when available (which honours `.gitignore`) and SHALL fall back to a
bounded in-process scan when `rg` is absent. The scan SHALL cap scanned files, bytes
per file, and total matches to bound response size.

The endpoint SHALL apply the same security gates as `/api/file`: `cwd` SHALL match a
known session path; resolved match paths SHALL remain within `cwd`; traversal attempts
SHALL be rejected.

#### Scenario: ripgrep-backed search returns matches
- **GIVEN** `ripgrep` is installed
- **WHEN** the client issues `GET /api/grep?cwd=/Users/u/proj&q=MAX_VISITS`
- **THEN** the response lists matches with `path`, `line`, and `snippet`
- **AND** `.gitignore`-ignored paths are excluded

#### Scenario: Fallback scan works without ripgrep
- **GIVEN** `ripgrep` is not on `PATH`
- **WHEN** the client issues a content search
- **THEN** the server performs a bounded in-process scan and returns matches
- **AND** the number of matches does not exceed the configured cap

#### Scenario: Path traversal rejected
- **WHEN** the client issues `GET /api/grep?cwd=/Users/u/proj&q=x` and a match would
  resolve outside `cwd`
- **THEN** that match SHALL be excluded and no path outside `cwd` SHALL be returned

#### Scenario: cwd not a known session is rejected
- **WHEN** the client issues `GET /api/grep` with a `cwd` that matches no session
- **THEN** the server responds with an error and performs no scan
