# memory-store-hygiene — delta

## ADDED Requirements

### Requirement: Agent memory stores are inventoried before anything is removed

The dashboard SHALL report an inventory of agent memory stores on disk, covering
total size per store root, per-project store directories with their sizes, and
counts of recognised stray artefacts (recovery files, orphaned per-session
databases). The inventory SHALL be readable without initiating any deletion, and
SHALL distinguish stores the dashboard owns from stores written by third-party
extensions.

#### Scenario: Operator views store inventory
- **GIVEN** memory stores exist on disk
- **WHEN** the operator opens the store-hygiene surface
- **THEN** the dashboard SHALL report total size per store root
- **AND** SHALL list per-project store directories with their sizes
- **AND** SHALL report counts of stray artefacts

#### Scenario: Inventory never mutates the store
- **GIVEN** the operator views the inventory
- **WHEN** no reclamation action has been invoked
- **THEN** no file in any store SHALL be created, modified or deleted

### Requirement: Reclamation is operator-initiated and preceded by a dry run

Reclamation SHALL be an explicit operator action. It SHALL NOT run on startup,
on a schedule, or as a side effect of any other action. Every reclamation SHALL
be available in a dry-run mode that reports exactly what would be removed
without removing it, and the executed action SHALL produce a record of what was
removed that survives the action.

#### Scenario: Dry run reports without deleting
- **GIVEN** stray artefacts exist in a store
- **WHEN** the operator requests a dry-run reclamation
- **THEN** the dashboard SHALL report each path that would be removed and the bytes reclaimed
- **AND** every reported path SHALL still exist afterwards

#### Scenario: Reclamation records what it removed
- **GIVEN** the operator confirms a reclamation
- **WHEN** the action completes
- **THEN** the removed paths and reclaimed bytes SHALL be recorded
- **AND** the record SHALL remain readable after the action finishes

#### Scenario: No implicit reclamation on startup, session start, or inventory read
- **GIVEN** a recorded set of store file paths and modification times
- **WHEN** the dashboard starts, a session starts, and the inventory is read
- **THEN** the set of store file paths SHALL be unchanged
- **AND** no recorded modification time SHALL have changed

### Requirement: Live stores are distinguished from retired lanes

Reclamation SHALL distinguish a store lane that is actively written from one that
has been retired. Retiring a capture lane SHALL stop new writes to it before its
existing data is offered for reclamation, so a lane cannot be emptied while a
writer refills it.

#### Scenario: Retired lane stops accepting writes before reclamation
- **GIVEN** a capture lane is retired
- **WHEN** subsequent sessions run to completion
- **THEN** the lane SHALL contain no files or rows created after the retirement
- **AND** the inventory SHALL mark it as retired

#### Scenario: A live lane is not offered for reclamation
- **GIVEN** a capture lane that is still being written
- **WHEN** the inventory is read
- **THEN** that lane SHALL be marked live
- **AND** SHALL NOT be offered for reclamation
