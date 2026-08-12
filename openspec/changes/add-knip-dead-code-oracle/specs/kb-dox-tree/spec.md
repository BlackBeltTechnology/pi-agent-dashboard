# KB DOX Tree

## ADDED Requirements

### Requirement: Orphan cross-check between module graph and doc tree

A cross-check script SHALL compare Knip's unused-file list against `kb dox lint`'s
orphan-row report, so module-graph drift and documentation drift are reconciled
as one measurement instead of two unrelated lists.

#### Scenario: File orphaned in both tools

- **WHEN** a file is reported unused by Knip and its directory `AGENTS.md` row is
  reported orphan by `kb dox lint`
- **THEN** the cross-check reports it as confirmed dead code
- **AND** it is listed as a deletion candidate

#### Scenario: Live file with an orphan doc row

- **WHEN** `kb dox lint` reports an orphan row for a file Knip considers reachable
- **THEN** the cross-check reports a documentation-only drift
- **AND** the remedy is recorded as a doc-tree fix, not a deletion

#### Scenario: Unused file that still has a doc row

- **WHEN** Knip reports a file unused but its `AGENTS.md` row is present and valid
- **THEN** the cross-check reports a code-only drift
- **AND** the row is flagged for removal alongside the file

#### Scenario: Clean reconciliation

- **WHEN** neither tool reports orphans
- **THEN** the cross-check reports no drift
- **AND** exits successfully
