# Spec Delta

## MODIFIED Requirements

### Requirement: Unsaved edits are guarded
A handler SHALL report whether it holds unsaved edits. Until it reports, its state SHALL be treated as unknown, and core SHALL treat unknown as unsaved, except in a bulk close as stated below.

Core SHALL ask for confirmation before discarding a handler instance that holds unsaved edits or is in an unknown state. That applies when:
- switching to another mode;
- closing the tab;
- reloading from disk via the changed-on-disk banner, manual refresh or the conflict dialog;
- leaving or reloading the page, including the reload that applies a plugin being disabled.

When several tabs close in one bulk action (see `editor-pane-chrome`), one summary confirmation listing every instance that holds unsaved edits SHALL serve as this confirmation for each listed instance; choosing to discard there SHALL NOT prompt again per instance, and choosing to keep them SHALL leave those tabs and instances open. In a bulk close only, an instance whose state is unknown SHALL be treated as saved: it is not listed and closes with its tab without a confirmation. Closing a single tab keeps treating unknown as unsaved.

Switching tabs, switching sessions, closing the editor pane or changing the layout SHALL NOT discard handler instances.

When the plugin providing an instance with unsaved edits or an unknown state is disabled, the instance SHALL stay open and tell the user to re-enable the plugin to save or to discard the edits; an instance with no unsaved edits SHALL close and its tab SHALL show the built-in view. A handler that reports no unsaved edits while holding some MAY lose them when its instance is closed to free resources; the handler contract SHALL state this.

#### Scenario: Switch away with unsaved edits
- **WHEN** a handler reports unsaved edits and the user selects the built-in Preview
- **THEN** a confirmation is shown, and Cancel keeps the handler with its edits

#### Scenario: Banner refresh on a handler tab
- **WHEN** the agent changes `report.docx` while a handler with unsaved edits is open, and the user chooses Refresh on the banner
- **THEN** a confirmation is shown before the handler reloads from disk

#### Scenario: Closing the editor pane keeps edits
- **WHEN** a handler holds unsaved edits and the user closes the editor pane and reopens it
- **THEN** the handler shows the edits without reloading

#### Scenario: Plugin disabled with unsaved edits
- **WHEN** a handler holds unsaved edits and its plugin is disabled
- **THEN** the edits are not discarded, and the user is told to re-enable the plugin to save or to discard them

#### Scenario: Handler never reports
- **WHEN** a handler never reports its saved state and the user closes its tab
- **THEN** a confirmation is shown

#### Scenario: Bulk close confirms once for several handlers
- **GIVEN** two handler tabs on different files, both holding unsaved edits
- **WHEN** the user chooses Close all tabs and then Close all & discard in the summary confirmation
- **THEN** both instances are discarded without any further prompt

#### Scenario: Bulk close does not prompt for an unknown state
- **GIVEN** a handler tab whose handler has never reported its saved state
- **WHEN** the user chooses Close all tabs and no other tab is at risk
- **THEN** all tabs close without a confirmation

#### Scenario: Single close still prompts for an unknown state
- **GIVEN** a handler tab whose handler has never reported its saved state
- **WHEN** the user closes that tab with its ×
- **THEN** a confirmation is shown
