# popover-positioning Specification

## Purpose

Provide an anchored, non-modal floating panel that positions itself relative to a trigger element's viewport rect, flips or shifts to stay within the viewport, keeps its position current as the viewport changes, and dismisses on outside interaction. It renders in a body-mounted portal so it escapes ancestor overflow and transform contexts.

## Requirements

### Requirement: Anchored placement

The popover SHALL position itself relative to the anchor element's viewport rectangle, defaulting to below the anchor and left-aligned to the anchor's left edge, separated by a configurable offset gap.

#### Scenario: Default placement below the anchor

- **WHEN** the popover is displayed and fits within the viewport
- **THEN** its top edge is placed at the anchor's bottom edge plus the offset
- **AND** its left edge is aligned to the anchor's left edge
- **AND** it reports a placement of "below"

#### Scenario: Offset gap between anchor and popover

- **WHEN** an offset value is supplied
- **THEN** that many pixels of gap separate the anchor and the popover edge
- **AND** when no offset is supplied a default gap of 6 pixels is used

#### Scenario: Rendered in a portal outside ancestor contexts

- **WHEN** the popover is displayed
- **THEN** it is mounted in a body-level portal with fixed positioning
- **AND** it is not clipped by any ancestor overflow or transform context

### Requirement: Viewport-aware overflow handling

The popover SHALL adjust its computed position to remain within the viewport, flipping above the anchor on vertical overflow when space allows, and shifting horizontally when it would overflow the left or right edge.

#### Scenario: Flip above on bottom overflow

- **WHEN** placing the popover below the anchor would extend past the viewport bottom
- **AND** there is room above the anchor for the popover plus the offset
- **THEN** the popover is placed above the anchor, with its bottom edge at the anchor's top minus the offset
- **AND** it reports a placement of "above"

#### Scenario: Insufficient room above keeps it below

- **WHEN** placing the popover below would overflow the bottom
- **AND** there is not enough room above the anchor for the popover plus the offset
- **THEN** the popover remains below the anchor
- **AND** it reports a placement of "below"

#### Scenario: Shift left on right overflow

- **WHEN** the popover aligned to the anchor's left edge would extend past the viewport right edge
- **THEN** its left position is shifted so it sits within the viewport with an 8-pixel margin from the right edge
- **AND** the left position is never less than an 8-pixel margin from the left edge

#### Scenario: Clamp to left margin

- **WHEN** the computed left position would place the popover past the viewport left edge
- **THEN** the left position is clamped to an 8-pixel margin from the left edge

### Requirement: Position tracking across viewport changes

The popover SHALL recompute its position when first displayed and whenever the viewport changes through resizing or scrolling of any ancestor, and SHALL avoid rendering at an incorrect position before it has been measured.

#### Scenario: Recompute on resize

- **WHEN** the window is resized
- **THEN** the popover recomputes its position against the new viewport dimensions

#### Scenario: Recompute on scroll in any ancestor

- **WHEN** any ancestor of the anchor scrolls
- **THEN** the popover recomputes its position against the anchor's new viewport rectangle

#### Scenario: No flicker before measurement

- **WHEN** the popover has not yet been measured and positioned
- **THEN** it is rendered hidden and off-screen until its first position is computed

### Requirement: Dismissal

The popover SHALL invoke its dismissal callback when the user interacts outside it, while treating interactions inside the popover or on the anchor as non-dismissing.

#### Scenario: Outside click dismisses

- **WHEN** the user presses the mouse down on an element that is neither inside the popover nor inside the anchor
- **THEN** the dismissal callback is invoked

#### Scenario: Click inside popover does not dismiss

- **WHEN** the user presses the mouse down inside the popover
- **THEN** the dismissal callback is not invoked

#### Scenario: Click on anchor does not dismiss

- **WHEN** the user presses the mouse down on the anchor element
- **THEN** the dismissal callback is not invoked

#### Scenario: Escape key dismisses

- **WHEN** the user presses the Escape key
- **THEN** the dismissal callback is invoked
