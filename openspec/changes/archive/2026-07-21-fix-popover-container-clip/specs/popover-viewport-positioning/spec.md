# popover-viewport-positioning — delta

## MODIFIED Requirements

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

The hook SHALL accept an optional clipping-boundary reference. When a boundary
element is provided, the hook SHALL measure available space on BOTH the
horizontal and vertical axes against that boundary's bounding rect instead of
the viewport — i.e. the room extending from an anchor edge SHALL be computed
against the boundary's left/right/top/bottom edges rather than
`window.innerWidth` / `window.innerHeight`. When no boundary is provided, the
hook SHALL measure against the viewport (the prior behavior on both axes), so
every existing call site is unaffected. Consuming popovers that render inside a
scrollable or `overflow`-clipped pane narrower than or offset from the viewport
SHALL supply their clipping pane as the boundary, so the popover flips/clamps
against the pane and its content is never clipped by the pane's `overflow` edge.

The hook SHALL accept an optional preferred horizontal anchor. A consumer whose
current anchor is the left edge SHALL be able to declare that preference so
opting into the horizontal axis does NOT change its default anchor when the
popover already fits; the hook SHALL keep the preferred anchor and flip only
when the preferred side cannot fit the needed width AND the opposite side has
more room. The hook SHALL also accept an optional minimum content width below
which it flips to the opposite anchor rather than returning a clamped `maxWidth`
that would render the content below its readable width; it clamps only when
neither side satisfies the minimum.

When a boundary is supplied, direction/anchor/`maxHeight`/`maxWidth` SHALL be
recomputed not only on window `resize`/`scroll` but also when the boundary
itself scrolls or changes size (so an internally-scrolling pane or a resized
split-pane does not leave the open popover clamped to a stale boundary rect).
When the supplied boundary contains the popover element, the hook SHALL emit a
development warning (the boundary must be the clipping pane, not the popover's
own overflow wrapper). Direction, `maxHeight`, horizontal anchor, and `maxWidth`
SHALL be recomputed on each open and on `resize` / `scroll` while open.
Listeners (window and, when supplied, boundary) SHALL be attached only while the
popover is open.

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

#### Scenario: Measures against a clipping boundary when one is supplied
- **GIVEN** a right-anchored popover whose trigger sits in a pane that is
  narrower than and offset from the viewport, and whose pane is supplied as the
  clipping boundary
- **AND** the space extending leftward from the trigger to the pane's left edge
  is smaller than the popover's natural width, while the viewport has ample room
  to the left of the pane
- **WHEN** the popover opens
- **THEN** the horizontal anchor is decided against the pane's edges, not the
  viewport
- **AND** the popover flips or clamps so its content stays within the pane
  rather than being clipped by the pane's `overflow` edge

#### Scenario: Falls back to the viewport when no boundary is supplied
- **GIVEN** a popover consumer that supplies no clipping boundary
- **WHEN** the popover opens
- **THEN** all space measurements use the viewport (`window.innerWidth` /
  `window.innerHeight`) on both axes, identical to the prior behavior

#### Scenario: Left-preferring consumer keeps its anchor when it fits
- **GIVEN** a consumer whose current anchor is `left-0` that opts into the
  horizontal axis with a preferred-left anchor, inside a boundary wide enough
  for the popover's width
- **WHEN** the popover opens
- **THEN** it stays `left-0` (its opt-in does not silently flip it to `right-0`)
- **AND** it flips to `right-0` only when the left side cannot fit the width and
  the right side has more room

#### Scenario: Flips instead of squishing below the readable width
- **GIVEN** a consumer that declares a minimum content width, in a boundary
  where the preferred side's space is below that minimum
- **WHEN** the popover opens
- **THEN** the hook flips to the opposite side rather than returning a clamped
  `maxWidth` below the minimum
- **AND** it clamps only when neither side satisfies the minimum

#### Scenario: Re-measures when the boundary scrolls or resizes
- **GIVEN** an open popover measured against a supplied boundary pane
- **WHEN** the boundary pane scrolls internally or changes size (e.g. a
  split-pane divider drag) without a window `resize`/`scroll`
- **THEN** the hook re-measures against the boundary's new rect within the same
  open session

#### Scenario: Re-evaluates on resize while open
- **GIVEN** an open popover positioned downward
- **WHEN** the viewport is resized so the popover would extend past the bottom
- **THEN** the popover re-positions upward within the same open session

#### Scenario: No listeners while closed
- **GIVEN** a popover whose `open` state is false
- **WHEN** the viewport is resized or scrolled
- **THEN** the hook performs no measurement and attaches no resize/scroll listeners
