# openspec-board

## Purpose

The board SHALL persist per-repo groups and change assignments on disk.

## Requirements

### Requirement: Changes are groupable

The board SHALL persist per-repo groups and change assignments on disk.

#### Scenario: changes are groupable

- **WHEN** a card is dragged between columns
- **THEN** the assignment survives a reload
