## MODIFIED Requirements

### Requirement: Folder OpenSpec section renders as a single-line entry

The folder OpenSpec section SHALL render as a single-line entry that navigates to the full-page OpenSpec board instead of expanding inline. The entry SHALL show the OpenSpec label and the change count, and SHALL act as a button that opens the board route `/folder/:encodedCwd/openspec`. The inline collapsible change tree, group pills, and in-section search SHALL be removed (their functionality moves to the board).

The entry SHALL NOT render a Refresh control, an Archive control, or a Specs control. Those actions are contributed to the folder actions menu instead, so the entry stays a single click target.

#### Scenario: Section renders as a navigating single-line entry

- **WHEN** the folder OpenSpec section renders for a folder with N changes
- **THEN** it SHALL show `OpenSpec (N) →` and SHALL NOT render an inline change tree
- **AND** it SHALL NOT render a Refresh, Archive, or Specs button

#### Scenario: Entry click opens the board

- **WHEN** the user activates the OpenSpec entry
- **THEN** the client SHALL navigate to `/folder/:encodedCwd/openspec`

### Requirement: Folder-level Refresh button

The per-slot OpenSpec Refresh control SHALL be removed. Refreshing a folder's OpenSpec data SHALL be performed by the single folder-level refresh item in the folder actions menu, which refetches every slot for that directory.

Archive and Specs SHALL be reachable as folder actions menu items in the open group, carrying slot-qualified labels so their origin is unambiguous.

#### Scenario: No OpenSpec-specific refresh item exists

- **WHEN** the folder actions menu opens for a folder with an OpenSpec slot
- **THEN** no OpenSpec-specific refresh item SHALL render
- **AND** the single folder refresh item SHALL refetch the OpenSpec data along with every other slot

#### Scenario: Archive and Specs are slot-qualified menu items

- **WHEN** the folder actions menu opens for a folder with an OpenSpec slot
- **THEN** the open group SHALL contain an archive item and a specs item
- **AND** each label SHALL name the OpenSpec slot it acts on
