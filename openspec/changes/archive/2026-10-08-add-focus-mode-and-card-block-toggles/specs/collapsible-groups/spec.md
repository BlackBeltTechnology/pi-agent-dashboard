## MODIFIED Requirements

### Requirement: Collapsible folder groups
Each folder group header SHALL include a chevron toggle icon (▸ collapsed, ▾ expanded). In `classic` folder list mode, clicking the chevron or the group header SHALL toggle the collapsed/expanded state of that group's session cards. In `accordion` folder list mode, only the chevron SHALL toggle the collapsed state (or, on an unfocused folder, pin the folder open / unpin it); activating the header body SHALL focus the folder (see `folder-focus`) and SHALL NOT toggle the collapsed state. The chevron SHALL be keyboard-operable and its activation SHALL NOT also trigger the header-body action.

When a group is collapsed, the header SHALL show only the folder's identity and status: the folder path/name, the session count, the `FolderNeedsYouPill` (when any child session needs attention), and a working/idle status rollup. The heavy header slots — git branch bar, folder action bar, sidebar-folder-section plugin slot, OpenSpec proposal-state section, and spawn buttons — SHALL NOT render while collapsed. All of these SHALL render again when the group is expanded; the git branch bar (`folder-git`), plugin sections (`pill-<pluginId>`), OpenSpec proposal-state section (`folder-openspec`) and spawn buttons (`folder-create`) SHALL additionally be subject to their section visibility. In accordion mode, the same condensed header SHALL be used for folders in either compact mode, and the chevron SHALL reflect the folder's rendered state (▾ when its session cards render in full, ▸ otherwise).

The folder group SHALL remain draggable (for reorder) while collapsed or compact: the drag handle SHALL NOT be part of the hidden slot block.

#### Scenario: Collapse a group
- **GIVEN** `classic` folder list mode
- **WHEN** a user clicks an expanded folder group header
- **THEN** the session cards within that group SHALL animate closed (smooth height transition) and the chevron SHALL change to ▸

#### Scenario: Expand a collapsed group
- **GIVEN** `classic` folder list mode
- **WHEN** a user clicks a collapsed folder group header
- **THEN** the session cards within that group SHALL animate open (smooth height transition) and the chevron SHALL change to ▾

#### Scenario: Default state
- **WHEN** a folder group is rendered for the first time with no persisted state
- **THEN** it SHALL be expanded by default and SHALL NOT be pinned open

#### Scenario: Collapsed header hides heavy slots
- **WHEN** a folder group is collapsed
- **THEN** the git branch bar, folder action bar, plugin sections, OpenSpec proposal-state section, and spawn buttons SHALL NOT be present in the DOM
- **AND** the folder name and session count SHALL still be shown

#### Scenario: Expanding restores the slots
- **WHEN** a user expands a previously collapsed folder group
- **THEN** the spawn buttons and other header slots SHALL become present again, subject to their section visibility

#### Scenario: Collapsed folder stays draggable
- **WHEN** a folder group is collapsed
- **THEN** its drag handle SHALL remain present so the folder can be reordered without expanding it first

#### Scenario: Accordion header body focuses only
- **GIVEN** `accordion` folder list mode
- **WHEN** the user activates the header body of folder `/foo`
- **THEN** `/foo`'s collapsed state SHALL NOT change and the chevron SHALL NOT change

#### Scenario: Accordion chevron on focused folder
- **GIVEN** `accordion` folder list mode and `/foo` focused and expanded
- **WHEN** the user activates `/foo`'s chevron
- **THEN** `/foo` SHALL collapse and the focused folder SHALL NOT change

#### Scenario: Accordion chevron on unfocused folder pins open
- **GIVEN** `accordion` folder list mode and `/foo` unfocused and not pinned open
- **WHEN** the user activates `/foo`'s chevron
- **THEN** `/foo` SHALL be pinned open and render all its session cards

#### Scenario: Accordion chevron on pinned folder unpins
- **GIVEN** `accordion` folder list mode and `/foo` pinned open and unfocused
- **WHEN** the user activates `/foo`'s chevron
- **THEN** `/foo` SHALL be unpinned and render in a compact mode
- **AND** its collapsed state SHALL NOT change
