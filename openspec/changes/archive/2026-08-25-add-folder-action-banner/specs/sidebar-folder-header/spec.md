## MODIFIED Requirements

### Requirement: Folder header uses gutter + content two-column layout

The folder header SHALL use a two-column layout:

1. **Left gutter** (fixed narrow column): the collapse chevron at the top, with the surrounding gutter area acting as the drag handle.
2. **Content column** (`flex-1 min-w-0`): folder icon + name + count on the first row, with the folder actions menu trigger as the row's single trailing control; branch (`GroupGitInfo`) on the second row, which carries git facts only; the tier-0 call-to-action banner below the branch row when one is warranted; `SidebarFolderSectionSlot` and (when initialized) `FolderOpenSpecSection` below.

The first row SHALL NOT carry a pin button — pinning is an item in the folder actions menu.

`FolderActionBar` no longer exists. Its initialization controls render in the tier-0 banner and its cleanup action is an item in the folder actions menu, so the git row shares space with nothing and stays facts-only.

#### Scenario: First row carries the menu trigger, not a pin button

- **WHEN** an expanded folder header renders
- **THEN** the first content row SHALL carry the folder icon, name, count, and the folder actions menu trigger
- **AND** it SHALL NOT carry a pin button

#### Scenario: The git row carries no action controls

- **WHEN** an expanded folder header renders for a directory with a pending initialization
- **THEN** the git row SHALL carry only the branch and dirty-state affordances
- **AND** the initialization control SHALL render in the banner below it

#### Scenario: A quiet folder renders no banner row

- **WHEN** an expanded folder header renders for a configured folder with no pending init and no blocking state
- **THEN** no banner SHALL render between the git row and the slot pills

#### Scenario: Gutter holds the chevron and the drag handle

- **WHEN** a folder header renders
- **THEN** the collapse chevron SHALL live in the left gutter
- **AND** the surrounding gutter area SHALL act as the drag handle

#### Scenario: Branch row sits in the content column with no extra indent

- **WHEN** a pinned folder header is rendered with a known git branch
- **THEN** the branch row SHALL NOT carry an `ml-5` or `ml-3` class
- **AND** the branch text SHALL render at the start of the content column

### Requirement: Chevron toggles collapse; surrounding gutter area is the drag handle

The chevron in the left gutter SHALL toggle the folder's collapsed state.

The folder-name row SHALL navigate to the directory home page rather than toggle collapse.

Interactive controls within that row (the folder actions menu trigger), on the git row (branch `GroupGitInfo`), and in the tier-0 banner (its call-to-action) MUST stop click propagation, or live outside the clickable row, so they perform their own action and MUST NOT collapse the folder or trigger row navigation.

#### Scenario: Chevron toggles collapse

- **WHEN** the user activates the chevron in the left gutter
- **THEN** the folder's collapsed state SHALL toggle

#### Scenario: Child controls neither collapse nor navigate

- **GIVEN** an expanded folder header
- **WHEN** the user activates the folder actions menu trigger, the branch control, or the banner's action
- **THEN** that control's own action SHALL fire
- **AND** the folder SHALL NOT collapse
- **AND** the client SHALL NOT navigate to the directory home page
