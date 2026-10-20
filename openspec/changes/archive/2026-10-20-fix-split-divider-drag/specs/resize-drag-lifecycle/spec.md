# Spec Delta

## Purpose

Governs how the web client's drag-to-resize affordances — the split-editor
divider, the editor browse-rail divider, the session sidebar seam and the diff
file-tree handle — track a drag and reliably end it, so a resize stays
responsive and never keeps following the pointer after the button is released.
(The directory-tree column handle is not yet covered.)

## ADDED Requirements

### Requirement: Drag tracking SHALL NOT be interrupted by embedded frames

While a resize drag is active, the affordance SHALL keep receiving pointer
movement and release even when the pointer passes over embedded content such
as an iframe-backed preview, live-server view, or embedded editor app. The
embedded content SHALL NOT receive pointer input for the duration of the drag.

#### Scenario: Dragging across an HTML preview
- **GIVEN** the editor pane shows an iframe-backed preview next to the divider
- **WHEN** the user drags the divider so the pointer moves over the preview
- **THEN** the divider SHALL keep following the pointer without freezing

#### Scenario: Releasing over an embedded frame ends the drag
- **GIVEN** a resize drag is active
- **WHEN** the user releases the pointer while it is over an iframe-backed preview
- **THEN** the drag SHALL end at that release
- **AND** subsequent pointer movement with no button pressed SHALL NOT resize anything

#### Scenario: Embedded content is interactive again after the drag
- **WHEN** a resize drag ends
- **THEN** the embedded content SHALL receive pointer input again as before the drag

### Requirement: A drag SHALL end when its release is lost

A resize drag SHALL end — clearing all drag overrides and committing the last
previewed size — when the platform cancels the pointer or loses its capture,
or when the first pointer movement observed after a missed release reports
that no button is pressed. The event that ends the drag this way SHALL NOT
change the size.

#### Scenario: Release missed, pointer returns with no button
- **GIVEN** a resize drag is active and its release was not delivered to the page
- **WHEN** the pointer next moves over the page with no button pressed
- **THEN** the drag SHALL end on that first movement
- **AND** the size SHALL stay at the last previewed value, not jump to the movement's position

#### Scenario: Release outside the browser window is delivered
- **GIVEN** a resize drag is active and the platform delivers the release even though the pointer is outside the window
- **WHEN** the pointer is released outside the window
- **THEN** the drag SHALL end at that release, with the size clamped as during the drag
- **AND** later pointer movement with no button pressed SHALL NOT resize anything

#### Scenario: Pointer cancelled by the platform
- **GIVEN** a resize drag is active
- **WHEN** the platform cancels the pointer
- **THEN** the drag SHALL end, commit the last previewed size, and clear the body cursor and text-selection overrides

#### Scenario: Affordance removed mid-drag
- **GIVEN** a resize drag is active
- **WHEN** the resize affordance is removed from the page before the drag ends
- **THEN** no size SHALL be committed or persisted for that drag

### Requirement: Drag preview SHALL be applied at most once per animation frame

During a resize drag the affordance SHALL update the visible pane sizes at most
once per rendered frame, using the most recent pointer position, regardless of
how many pointer events the input device delivers.

#### Scenario: High-rate pointer input
- **WHEN** more than one pointer movement arrives within a single animation frame during a drag
- **THEN** the pane sizes SHALL be updated once for that frame, from the latest pointer position

### Requirement: Split and rail dividers SHALL commit size once on release

The split-editor divider and the editor browse-rail divider SHALL show the live
resize during the drag without re-rendering the surrounding workspace and
without writing persisted state per frame. The final clamped size SHALL be
committed to workspace state and persisted exactly once, when the drag ends.

#### Scenario: Ratio persisted once per drag
- **GIVEN** `split` mode
- **WHEN** the user drags the split divider across many frames and releases
- **THEN** the persisted split ratio SHALL be written once, after release
- **AND** the stored value SHALL equal the clamped ratio shown at release

#### Scenario: Rail width persisted once per drag
- **WHEN** the user drags the browse-rail divider and releases
- **THEN** the persisted rail width SHALL be written once, after release, clamped as before

#### Scenario: Live preview tracks the pointer
- **WHEN** the user drags the split divider without releasing
- **THEN** the chat and editor panes SHALL visibly resize to follow the pointer, within the existing ratio clamp

#### Scenario: Unrelated re-render mid-drag keeps the preview
- **GIVEN** a split-divider drag is in progress
- **WHEN** the workspace re-renders for an unrelated reason (e.g. a streaming chat update) without the stored ratio changing
- **THEN** the panes SHALL keep the live previewed sizes

#### Scenario: Click without movement
- **WHEN** the user presses and releases the divider without moving the pointer
- **THEN** the pane sizes SHALL remain unchanged
- **AND** nothing SHALL be persisted

#### Scenario: Pressing the divider keeps editing focus
- **GIVEN** the chat composer or editor has keyboard focus
- **WHEN** the user presses the divider to start a drag
- **THEN** keyboard focus SHALL remain where it was
