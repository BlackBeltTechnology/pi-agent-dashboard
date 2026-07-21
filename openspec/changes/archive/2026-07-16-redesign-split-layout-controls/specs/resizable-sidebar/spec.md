# resizable-sidebar — delta

## MODIFIED Requirements

### Requirement: Sidebar drag-to-resize

The sidebar SHALL be resizable by dragging a seam on its right edge. The seam SHALL
render an **always-visible dotted grip signifier** matching the split divider, so the
two resize seams share one visual language. The width SHALL be constrained between
180px minimum and 500px maximum.

#### Scenario: Drag to resize
- **WHEN** user presses mouse down on the seam grip and moves horizontally
- **THEN** the sidebar width updates to follow the cursor, clamped to 180–500px

#### Scenario: Grip is always visible
- **GIVEN** the sidebar is expanded
- **THEN** the dotted grip signifier is visible at rest on the seam (not hover-only)

#### Scenario: Width clamped at minimum
- **WHEN** user drags the grip to less than 180px
- **THEN** the sidebar width remains at 180px

#### Scenario: Width clamped at maximum
- **WHEN** user drags the grip to more than 500px
- **THEN** the sidebar width remains at 500px

### Requirement: Sidebar collapse via toggle button

The seam SHALL display a collapse chevron **knob, vertically centered** on the seam.
Clicking it SHALL collapse the sidebar. When collapsed, the sidebar SHALL restore via
an **always-visible, vertically-centered vertical `SESSIONS` tab** that uses the same
rotated-tab idiom as the split workspace's CHAT/EDITOR restore tabs. The `SESSIONS`
tab SHALL be a keyboard-focusable control with an accessible name (activated by
Enter/Space). This desktop affordance applies above the mobile breakpoint only; below
it, the existing hamburger overlay governs sidebar visibility and the `SESSIONS` tab
SHALL NOT render.

#### Scenario: Collapse knob is centered
- **WHEN** the sidebar is expanded
- **THEN** a collapse knob SHALL be visible, vertically centered on the seam

#### Scenario: Click collapse knob
- **WHEN** user clicks the centered collapse knob
- **THEN** the sidebar SHALL collapse and a vertical `SESSIONS` restore tab SHALL appear

#### Scenario: Expand via SESSIONS tab
- **WHEN** user activates the vertical `SESSIONS` tab
- **THEN** the sidebar SHALL expand to its previously saved width
- **AND** the `SESSIONS` tab SHALL be vertically centered on the collapsed strip

#### Scenario: SESSIONS tab is a desktop affordance only
- **GIVEN** a viewport below the mobile breakpoint
- **THEN** the sidebar is governed by the hamburger overlay, not the collapse knob
- **AND** the vertical `SESSIONS` tab does not render

#### Scenario: Collapse knob does not interfere with drag
- **WHEN** user presses mouse down on the seam outside the knob
- **THEN** drag-to-resize SHALL work normally
