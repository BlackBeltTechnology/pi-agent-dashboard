## MODIFIED Requirements

### Requirement: Folder KB section exposes a reindex control

The KB folder section SHALL NOT render a reindex control inside its slot pill. The pill SHALL remain a single click target that opens the KB settings/board, and its state (chunk count, stale marker) SHALL continue to render inline within the pill.

Reindexing SHALL instead be contributed as a single folder actions menu item in the maintenance group. That one item SHALL cover every state the three former buttons covered — never indexed, stale, and last-run-failed — and SHALL convey the current state through its badge and label rather than through three separate controls.

Because the states differ in meaning, the item's badge SHALL distinguish a stale index from a failed index; a failure SHALL NOT be presented as staleness.

The item SHALL remain distinct from the folder-level refresh item: refresh refetches displayed data, reindex rebuilds the index.

#### Scenario: Pill exposes no reindex button

- **WHEN** the KB folder section renders its pill
- **THEN** no Retry, Index now, or refresh-icon button SHALL render inside the pill
- **AND** the pill SHALL remain one click target

#### Scenario: One menu item covers all three states

- **WHEN** the folder actions menu opens for a folder whose KB has never been indexed
- **THEN** exactly one KB reindex item SHALL render in the maintenance group
- **WHEN** the same menu opens for a folder whose KB is stale
- **THEN** exactly one KB reindex item SHALL render, badged with the stale count
- **WHEN** the same menu opens for a folder whose last index run failed
- **THEN** exactly one KB reindex item SHALL render, badged to indicate failure rather than staleness

#### Scenario: Reindex is in-flight safe

- **WHEN** the KB reindex item is activated
- **THEN** it SHALL reflect the in-flight state immediately
- **AND** SHALL prevent a second submission while a reindex is in flight

#### Scenario: Reindex is not folded into folder refresh

- **GIVEN** a folder whose knowledge base is stale
- **WHEN** the folder actions menu opens
- **THEN** a KB reindex item SHALL render alongside the folder refresh item
- **AND** activating folder refresh SHALL NOT rebuild the index
