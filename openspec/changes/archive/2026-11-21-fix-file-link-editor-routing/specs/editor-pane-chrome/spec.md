## MODIFIED Requirements

### Requirement: Bulk close SHALL confirm once when it would lose work

A bulk close (Close other tabs, Close tabs to the right, Close all tabs, Close N matching tabs) SHALL first determine which target tabs are at risk:
- a terminal tab, because closing ends the terminal;
- a handler tab whose instance holds unsaved edits, unless a tab that stays open shares that instance; an instance that has not reported its state is not at risk in a bulk close (see `editor-pane-file-handlers`);
- a built-in editable tab (`MarkdownViewer`, `EditablePreviewTab`) whose buffer is unsaved (see `internal-monaco-editor-pane`).

When no target is at risk, the tabs SHALL close without a confirmation. Otherwise, one confirmation SHALL list each at-risk tab with its reason and offer:
- **Cancel:** closes nothing, and receives focus when the confirmation opens;
- **Close all but these N:** closes only the targets not at risk;
- **Close all & discard:** closes every target, ends the listed terminals and discards the listed edits, without a further prompt per tab.

The set of at-risk tabs SHALL be computed again from the current tabs when the user confirms. When it contains a tab the confirmation did not list, nothing SHALL close and the confirmation SHALL be shown again with the updated list; only listed terminals and listed edits are ever ended or discarded. An instance shared by several closing tabs SHALL be listed once, and "N" SHALL count the tabs that stay open. Opening the confirmation SHALL first close any open pane menu or Search tabs popover, so Escape in the confirmation dismisses only the confirmation, and the close-tab keyboard shortcut SHALL do nothing while the confirmation, the Search tabs popover or any pane menu is open. The confirmation SHALL carry `data-testid="bulk-close-confirm"`.

Closing a single built-in editable tab with an unsaved buffer SHALL ask Save / Discard / Cancel (see `internal-monaco-editor-pane`); every other single close keeps its existing per-tab behaviour.

#### Scenario: Terminal and unsaved handler in a bulk close
- **GIVEN** five tabs including terminal `zsh` and `memo.pdf` whose handler holds unsaved edits
- **WHEN** the user chooses Close all tabs
- **THEN** one confirmation lists `zsh` (terminal will be ended) and `memo.pdf` (unsaved edits)
- **AND** no other prompt appears

#### Scenario: Close all but these
- **GIVEN** the confirmation from the previous scenario
- **WHEN** the user chooses Close all but these 2
- **THEN** `zsh` and `memo.pdf` remain open, the terminal keeps running and the edits are kept
- **AND** the other three tabs are closed

#### Scenario: Close all and discard
- **GIVEN** the same confirmation
- **WHEN** the user chooses Close all & discard
- **THEN** all five tabs close, terminal `zsh` is ended and the handler instance is discarded

#### Scenario: Cancel keeps everything
- **WHEN** the user chooses Cancel or presses Escape in the confirmation
- **THEN** no tab is closed

#### Scenario: Unsaved built-in buffer is listed in a bulk close
- **GIVEN** three tabs including `notes.md` in Edit mode with an unsaved buffer
- **WHEN** the user chooses Close all tabs
- **THEN** one confirmation lists `notes.md` (unsaved changes will be lost)
- **AND** choosing Close all & discard closes it without a further prompt

#### Scenario: Unreported handler state closes silently in bulk
- **GIVEN** three tabs, one a handler tab whose handler never reported its saved state
- **WHEN** the user chooses Close all tabs
- **THEN** all three close without a confirmation

#### Scenario: A tab edited during the confirmation is listed before anything closes
- **GIVEN** the confirmation for Close all tabs lists only terminal `zsh`
- **WHEN** `memo.pdf`'s handler reports unsaved edits and the user then chooses Close all & discard
- **THEN** no tab closes and the confirmation is shown again listing `zsh` and `memo.pdf`

#### Scenario: Close-tab shortcut is inert under the confirmation
- **GIVEN** the bulk-close confirmation lists terminal `zsh`
- **WHEN** the user presses Cmd/Ctrl-W
- **THEN** no tab closes and the terminal keeps running
