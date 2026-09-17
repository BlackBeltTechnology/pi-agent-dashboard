## Purpose

Governs the document-level cursor and text-selection overrides that drag-to-resize
affordances apply while a drag is in progress, so a drag can never leave the page
permanently unselectable or stuck on a resize cursor.

## ADDED Requirements

### Requirement: Drag body overrides are scoped to the drag lifecycle

A drag-to-resize affordance MAY override the document body's cursor and disable
text selection for the duration of a drag. Those overrides SHALL be applied only
while a drag is active, and SHALL ALWAYS be cleared when the drag ends.

Clearing SHALL restore the document to its pre-drag state: text SHALL be
selectable and copyable again, and the cursor SHALL revert to its normal
document-driven appearance.

#### Scenario: Drag start applies the overrides
- **WHEN** the user presses the pointer on a resize handle and begins a drag
- **THEN** the document body SHALL show the drag cursor
- **AND** text selection SHALL be suppressed for the duration of the drag

#### Scenario: Drag end restores selection and cursor
- **WHEN** the user releases the pointer to end the drag
- **THEN** the cursor and text-selection overrides SHALL be cleared
- **AND** page text SHALL be selectable and copyable again

### Requirement: Overrides are cleared even when the drag never ends normally

A drag-to-resize affordance SHALL clear its body cursor and text-selection
overrides when the affordance is removed from the page while a drag is still
active — for example because the layout changed responsive breakpoint, a panel
collapsed, or the user switched session mid-drag.

An affordance that is removed while NOT dragging SHALL NOT alter the document's
cursor or text-selection state, so that a concurrently dragging affordance is
unaffected and so that repeated mount/unmount cycles (e.g. React StrictMode's
double invocation) are harmless.

#### Scenario: Affordance disappears mid-drag
- **WHEN** a drag is in progress AND the resize affordance is removed from the page before the pointer is released
- **THEN** the cursor and text-selection overrides SHALL be cleared
- **AND** page text SHALL remain selectable and copyable

#### Scenario: Idle affordance removal touches nothing
- **WHEN** a resize affordance is removed from the page while no drag is in progress
- **THEN** the document's cursor and text-selection state SHALL be left unchanged

#### Scenario: One affordance's removal does not disrupt another's active drag
- **GIVEN** two resize affordances are present and one of them is mid-drag
- **WHEN** the other (idle) affordance is removed from the page
- **THEN** the in-progress drag SHALL retain its cursor and selection overrides
- **AND** those overrides SHALL still be cleared when that drag ends

### Requirement: Every drag-to-resize affordance obeys this contract

All drag-to-resize affordances in the web client — the session sidebar width
handle, the split-editor divider, and the diff view's file-tree panel handle —
SHALL obey the lifecycle contract above, via a single shared mechanism rather
than per-component copies of the same override logic.

#### Scenario: Each affordance clears on unmount mid-drag
- **WHEN** any of the sidebar, split divider, or diff tree-panel handles is mid-drag AND is removed from the page
- **THEN** the document SHALL be left selectable with no residual drag cursor
