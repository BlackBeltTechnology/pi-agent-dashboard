## ADDED Requirements

### Requirement: Scrollable panes hosting popovers SHALL provide themselves as the clipping boundary

Every scrollable or `overflow`-clipped pane that hosts popover consumers SHALL
provide its own scroll element as the popover clipping boundary via
`PopoverBoundaryProvider`, so descendant popovers measure their available space
against the pane rather than falling through to the viewport.

A boundary-aware popover consumer that receives no boundary measures against the
viewport. Inside an offset scroll pane this yields available space the pane does
not actually have, so the popover renders past the pane's `overflow` edge and is
visually clipped. Provisioning is therefore required at the pane, not optional.

When scroll panes are nested, the pane provided as the boundary SHALL be the one
that actually clips the popover — the innermost scrollable ancestor of the
popover's trigger. A boundary that does not contain the trigger SHALL NOT be
supplied.

The provided boundary SHALL be the clipping pane itself and never a popover's own
internal overflow wrapper, so a popover is never clamped against itself.

A modal dialog panel that is `overflow`-clipped and height-capped (e.g.
`max-h-[80vh] overflow-y-auto`) is such a pane, and SHALL provide itself as the
boundary for popovers mounted in its body. A dialog is typically far shorter than
the viewport, so a viewport-measured popover inside one over-reports its space by
the largest margin of any surface.

A boundary MAY be resolved by a scoped lookup from the consumer's own container
(e.g. the nearest `[role="dialog"]` ancestor) rather than a literal ref to a known
element. Such a lookup SHALL be scoped to a single known ancestor selector — it is
not the rejected general `overflow` ancestor walk — and SHALL still satisfy the
contains-the-trigger requirement above.

#### Scenario: Settings scroll pane provides its boundary
- **GIVEN** the Settings panel, whose page content renders in a scrollable pane
- **WHEN** a popover consumer inside it (e.g. the model selector) opens
- **THEN** its available space is measured against the Settings scroll pane's rect
- **AND** the popover renders fully inside the pane rather than past its
  `overflow` edge

#### Scenario: Chat composer hosts outside the split workspace provide their boundary
- **GIVEN** a chat composer rendered by a host other than the split workspace
- **WHEN** a composer popover (e.g. the model selector) opens
- **THEN** its available space is measured against that host's scroll pane
- **AND** the popover is not clipped by the pane edge

#### Scenario: A launch dialog provides its panel as the boundary
- **GIVEN** an OpenSpec launch dialog (Explore / Propose / New Change) whose
  panel is `overflow`-clipped and height-capped, hosting the run-config row's
  model and effort selectors
- **WHEN** one of those selectors opens
- **THEN** its available space is measured against the dialog panel's rect
- **AND** the popover renders fully inside the panel rather than past its
  `overflow` edge
- **AND** the panel's scroll extent is unchanged, so no second scrollbar appears

#### Scenario: Innermost clipping pane wins when panes are nested
- **GIVEN** a popover trigger inside nested scrollable panes
- **WHEN** the boundary is provided
- **THEN** the boundary is the innermost scrollable ancestor containing the trigger
- **AND** the popover is bounded by the pane that actually clips it

#### Scenario: Boundary-less consumer still behaves as before
- **GIVEN** a popover consumer mounted at the viewport root with no enclosing
  scroll pane
- **WHEN** it opens
- **THEN** no boundary is provided and it measures against the viewport,
  unchanged from prior behavior

### Requirement: An open popover SHALL NOT grow its host pane's scroll extent

An open popover SHALL NOT increase the scrollable extent of its host pane. The
pane's scroll height SHALL be unchanged by opening the popover, so no additional
("second") scrollbar appears and the pane's layout does not stretch.

A popover is absolutely positioned within the pane's scroll content, so a
popover box extending beyond the pane's visible height enlarges the pane's
scrollable area. This both clips the popover and breaks the surrounding layout's
consistency. Because the popover's height is bounded by the pane-measured
available space, this condition SHALL NOT arise.

Content that cannot fit inside the bounded popover SHALL scroll within the
popover's own content region, never by scrolling or extending the host pane.

#### Scenario: Opening a popover adds no scrollbar to the Settings pane
- **GIVEN** the Settings scroll pane with its scroll extent equal to its visible height
- **WHEN** a popover inside it opens with more content than fits
- **THEN** the pane's scroll extent is unchanged
- **AND** no second scrollbar appears on the pane
- **AND** the popover's content scrolls internally

#### Scenario: Opening a composer popover does not stretch the chat pane
- **GIVEN** a chat pane whose composer is pinned at the pane's bottom edge
- **WHEN** a composer popover opens with more content than the space below the trigger
- **THEN** the popover opens into the direction with available space instead of
  extending below the pane
- **AND** the chat pane's scroll extent and layout are unchanged
- **AND** no second scrollbar appears

#### Scenario: Bounded popover scrolls its own content
- **GIVEN** an open popover whose content exceeds its bounded height
- **WHEN** the user scrolls the popover's list
- **THEN** the list scrolls within the popover
- **AND** the host pane does not scroll and does not change size
