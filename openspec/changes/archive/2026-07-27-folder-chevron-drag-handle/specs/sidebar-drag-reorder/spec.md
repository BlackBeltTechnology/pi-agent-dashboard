## ADDED Requirements

### Requirement: Folder collapse chevron doubles as a drag handle

The folder header's collapse chevron SHALL act as a drag-activation surface in
addition to toggling the folder's collapsed state. A pointer interaction on the
chevron that stays within the drag sensor's activation distance SHALL toggle
collapse; a pointer interaction that moves beyond the activation distance SHALL
begin a folder reorder drag using the folder header's existing drag listeners.
The chevron SHALL remain rendered in both the collapsed and expanded states so a
collapsed folder remains reorderable via its chevron. The left gutter column
below the chevron SHALL remain a drag-activation surface for the same folder.

#### Scenario: Clicking the chevron toggles collapse

- **WHEN** a user clicks the folder collapse chevron without moving past the
  activation distance
- **THEN** the folder's collapsed state SHALL toggle
- **AND** no reorder drag SHALL begin

#### Scenario: Dragging the chevron reorders the folder

- **WHEN** a user presses the folder collapse chevron and moves the pointer
  beyond the activation distance
- **THEN** a folder reorder drag SHALL begin
- **AND** the collapse state SHALL NOT toggle for that interaction

#### Scenario: Collapsed folder is reorderable via its chevron

- **WHEN** a folder is collapsed
- **THEN** its chevron SHALL still be rendered
- **AND** dragging that chevron SHALL reorder the collapsed folder

#### Scenario: Gutter column remains draggable

- **WHEN** a user drags the gutter column below the chevron
- **THEN** the folder reorder drag SHALL begin as before
