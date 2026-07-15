# Popover viewport positioning

## Purpose

Shared client hook guaranteeing any viewport-anchored popover
(dropdown/menu positioned relative to a trigger button) flips direction and
caps its height to stay fully on-screen. Single source of truth retiring the
hand-rolled "open upward + cap height" logic previously duplicated across
several popovers.

See change: fix-popover-viewport-flip.
## Requirements
### Requirement: Viewport-anchored popovers SHALL flip and clamp to stay on-screen

The client SHALL provide a shared `usePopoverFlip` hook consumed by
viewport-anchored popovers (dropdowns/menus positioned relative to a trigger
button). The hook SHALL measure the trigger's bounding rect and decide an open
direction so the popover stays within the viewport.

The default direction SHALL be downward (below the trigger). The hook SHALL
choose upward (above the trigger) when the space below the trigger is smaller
than the lesser of the popover's needed height and a 200px threshold, AND the
space above the trigger is larger than the space below.

The hook SHALL return a `maxHeight` clamped to the available space in the chosen
direction, with a minimum floor (≈120px). Consuming popovers SHALL apply this
`maxHeight` together with internal vertical scroll, so the popover never extends
past the viewport edge even when neither direction has room for the full list.

In addition to the vertical axis, the hook SHALL decide a horizontal anchor
edge so the popover stays within the viewport horizontally. The default
horizontal anchor SHALL preserve the consumer's existing edge (right-anchored
popovers stay right-anchored). The hook SHALL flip the horizontal anchor to the
opposite edge when the space extending from the current anchor is smaller than
the popover's needed width AND the opposite side has more room. The hook SHALL
return a `maxWidth` clamped to the available horizontal space in the chosen
anchor direction, with a minimum floor, so a popover in a container narrower
than its natural width never extends past the viewport/container edge.

Direction, `maxHeight`, horizontal anchor, and `maxWidth` SHALL be recomputed on
each open and on `resize` / `scroll` while open. Listeners SHALL be attached
only while the popover is open.

#### Scenario: Opens downward with room below
- **GIVEN** a popover trigger in the upper half of the viewport
- **WHEN** the popover opens
- **THEN** it renders below the trigger
- **AND** its `maxHeight` is clamped to the space below the trigger

#### Scenario: Flips upward near the viewport bottom
- **GIVEN** a popover trigger within 200px of the viewport bottom
- **AND** more space exists above the trigger than below
- **WHEN** the popover opens
- **THEN** it renders above the trigger

#### Scenario: Clamps height when neither side fits the full list
- **GIVEN** a popover whose content is taller than the larger of the two side spaces
- **WHEN** it opens in the chosen direction
- **THEN** its rendered height equals the available space in that direction
- **AND** its content scrolls internally rather than overflowing the viewport

#### Scenario: Keeps its horizontal anchor when there is room
- **GIVEN** a right-anchored popover in a container wider than the popover's width
- **WHEN** the popover opens
- **THEN** it stays right-anchored
- **AND** its content is not clipped horizontally

#### Scenario: Flips horizontal anchor in a slim container
- **GIVEN** a right-anchored popover whose trigger sits near the left edge of a
  slim container narrower than the popover's natural width
- **WHEN** the popover opens
- **THEN** it anchors to the edge with more available horizontal space
- **AND** the popover stays within the viewport rather than clipping off-screen

#### Scenario: Clamps width when neither side fits the full width
- **GIVEN** a popover whose natural width exceeds the larger of the two
  horizontal side spaces
- **WHEN** it opens in the chosen anchor direction
- **THEN** its rendered width equals the available space in that direction
  (down to the minimum floor)

#### Scenario: Re-evaluates on resize while open
- **GIVEN** an open popover positioned downward
- **WHEN** the viewport is resized so the popover would extend past the bottom
- **THEN** the popover re-positions upward within the same open session

#### Scenario: No listeners while closed
- **GIVEN** a popover whose `open` state is false
- **WHEN** the viewport is resized or scrolled
- **THEN** the hook performs no measurement and attaches no resize/scroll listeners

