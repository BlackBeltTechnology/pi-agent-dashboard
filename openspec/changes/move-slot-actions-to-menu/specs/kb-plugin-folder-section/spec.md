## MODIFIED Requirements

### Requirement: Reindex action affordance

The KB folder section SHALL NOT render an action control inside its pill. It SHALL instead contribute a single declarative reindex item to the `folder-actions-menu` slot, in the `MAINTENANCE` group, which triggers a reindex of the folder's KB.

That one item SHALL express every former state through its own label, badge and disabled state — not through separate items: "Retry" in the `error` state, disabled with an in-progress indication in the `indexing` state, "Index now" in the `not-indexed` state, and "Reindex" in the `stale` or `populated` state, carrying the stale badge when stale. Because activation now happens in the menu, the former click-propagation carve-out (stopping the action from also opening settings) no longer applies.

#### Scenario: State varies the single menu item

- **WHEN** the KB is in the `error` state
- **THEN** the menu SHALL show one KB item labelled "Retry" that calls `reindex()` on activation
- **WHEN** the KB is in the `indexing` state
- **THEN** the menu SHALL show one KB item that is disabled and indicates progress
- **WHEN** the KB is in the `not-indexed` state
- **THEN** the menu SHALL show one KB item labelled "Index now" that calls `reindex()` on activation
- **WHEN** the KB is in the `stale` or `populated` state
- **THEN** the menu SHALL show one KB item labelled "Reindex" that calls `reindex()` on activation

#### Scenario: Never more than one KB action

- **WHEN** the menu renders for any KB state
- **THEN** exactly one KB reindex item SHALL render

#### Scenario: Pill carries no action control

- **WHEN** the KB folder section renders its pill
- **THEN** no reindex, retry or index-now control SHALL render inside the pill

### Requirement: Optimistic pending and double-submit prevention

The section SHALL reflect a reindex activation immediately and SHALL prevent a second submission while a reindex is in flight.

#### Scenario: Activation renders the indexing branch optimistically

- **WHEN** the user activates the reindex menu item and `pending` becomes true
- **THEN** the section renders the `indexing` branch immediately, before the server's 202 response or first stats poll
- **AND** an `error` condition still outranks `pending` so a rejected trigger shows the error/Retry state instead of a spinner

#### Scenario: Menu item disabled while busy

- **WHEN** `busy` is true, where `busy` is `pending` OR `stats.indexing`
- **THEN** the KB reindex menu item SHALL render disabled and SHALL NOT invoke its callback
- **AND** this covers the whole pending-plus-indexing window to prevent double-submit
- **AND** the guard SHALL cover the optimistic `pending` window, not only the polled `indexing` state
