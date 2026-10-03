# zoomable-mermaid Specification

## Purpose

Makes rendered Mermaid diagrams readable when they are larger than their bubble. Defines zoom and pan interaction, zoom control buttons, a click-to-activate focus model so page scrolling is not hijacked, a wide bubble layout, and viewport containment.

## Requirements

### Requirement: Zoom interaction
The MermaidBlock component SHALL support zooming via mouse wheel scroll and pinch-to-zoom gestures. Zoom SHALL be centered on the cursor/pinch midpoint. Zoom scale SHALL be bounded between 0.5× and 4×.

#### Scenario: Mouse wheel zoom in
- **WHEN** the user scrolls the mouse wheel up over a Mermaid diagram
- **THEN** the diagram SHALL zoom in, centered on the cursor position

#### Scenario: Mouse wheel zoom out
- **WHEN** the user scrolls the mouse wheel down over a Mermaid diagram
- **THEN** the diagram SHALL zoom out, centered on the cursor position

#### Scenario: Pinch-to-zoom on touch
- **WHEN** the user performs a two-finger pinch gesture on a Mermaid diagram
- **THEN** the diagram SHALL zoom in or out centered on the pinch midpoint

#### Scenario: Zoom at maximum scale
- **WHEN** the diagram is at 4× scale and the user attempts to zoom in further
- **THEN** the scale SHALL remain at 4× (no further zoom)

#### Scenario: Zoom at minimum scale
- **WHEN** the diagram is at 0.5× scale and the user attempts to zoom out further
- **THEN** the scale SHALL remain at 0.5× (no further zoom)

### Requirement: Pan interaction
The MermaidBlock component SHALL support panning via click-and-drag (mouse) and single-finger drag (touch when zoomed). The diagram SHALL use CSS `transform` for positioning.

#### Scenario: Click-drag to pan
- **WHEN** the user clicks and drags on a Mermaid diagram
- **THEN** the diagram SHALL pan following the drag direction

#### Scenario: Touch drag to pan
- **WHEN** the user performs a single-finger drag on a zoomed Mermaid diagram on a touch device
- **THEN** the diagram SHALL pan following the drag direction

### Requirement: Zoom control buttons
The MermaidBlock component SHALL display overlay control buttons for zoom in (+), zoom out (−), and reset (fit to container).

#### Scenario: Zoom in button
- **WHEN** the user clicks the zoom-in (+) button
- **THEN** the diagram SHALL zoom in by a fixed step (e.g., 1.2× multiplier)

#### Scenario: Zoom out button
- **WHEN** the user clicks the zoom-out (−) button
- **THEN** the diagram SHALL zoom out by a fixed step

#### Scenario: Reset button
- **WHEN** the user clicks the reset button
- **THEN** the diagram SHALL return to its initial scale and position (fit to container)

#### Scenario: Double-click to reset
- **WHEN** the user double-clicks on the diagram
- **THEN** the diagram SHALL reset to its initial scale and position

#### Scenario: Control button visibility when focused
- **WHEN** a Mermaid diagram is focused (clicked by the user)
- **THEN** zoom control buttons SHALL be displayed overlaid on the diagram container

#### Scenario: Control buttons hidden when unfocused
- **WHEN** a Mermaid diagram is not focused
- **THEN** zoom control buttons SHALL NOT be displayed

### Requirement: Click-to-activate focus model
Zoom and pan interactions SHALL only be active when the user has clicked the diagram to focus it. When unfocused, scroll and touch events SHALL pass through to the page normally.

#### Scenario: Click to focus
- **WHEN** the user clicks on an unfocused Mermaid diagram
- **THEN** the diagram SHALL enter focused state with a visible focus indicator (blue border) and enable zoom/pan interactions

#### Scenario: Click outside to deactivate
- **WHEN** the user clicks outside a focused Mermaid diagram
- **THEN** the diagram SHALL exit focused state and zoom/pan interactions SHALL be disabled

#### Scenario: Escape to deactivate
- **WHEN** the user presses Escape while a Mermaid diagram is focused
- **THEN** the diagram SHALL exit focused state

#### Scenario: Hover hint when unfocused
- **WHEN** the user hovers over an unfocused Mermaid diagram
- **THEN** a "Click to zoom & pan" hint SHALL appear

#### Scenario: Scroll passthrough when unfocused
- **WHEN** the user scrolls over an unfocused Mermaid diagram
- **THEN** the page SHALL scroll normally without zooming the diagram

### Requirement: Wide bubble layout
Chat bubbles containing Mermaid diagrams SHALL expand to 95% of the content area width to give diagrams more room.

#### Scenario: Desktop wide bubble
- **WHEN** an assistant message contains a Mermaid diagram on desktop
- **THEN** the chat bubble SHALL be forced to 95% width instead of the default 80% max-width

#### Scenario: Mobile layout
- **WHEN** an assistant message contains a Mermaid diagram on mobile
- **THEN** the chat bubble SHALL use 95% width (consistent with desktop)

### Requirement: Viewport containment
The MermaidBlock component SHALL clip the diagram within a fixed-height viewport
container with `overflow: hidden` so that zoomed/panned content does not spill
outside. The viewport height SHALL be set explicitly rather than derived from the
rendered SVG's natural height, because CSS `transform: scale()` does not affect
layout: a container sized by its unscaled content keeps that height when zoomed,
shrinking the usable window to the pre-zoom box.

The viewport height SHALL be `clamp(240px, 50vh, 640px)`, bounding it on both
small and large screens.

The diagram SHALL be fitted to that viewport on first render, and that fitted
scale SHALL be supplied as the surface's initial scale — which is what makes the
existing "Reset button" and "Double-click to reset" scenarios, both of which
already specify a return to "fit to container", satisfiable.

"Fitted" means **contain**: the scale SHALL be `min(viewportWidth / intrinsicWidth,
viewportHeight / intrinsicHeight)`, so the whole diagram is visible and residual
space may remain on one axis. Cropping the diagram to fill the viewport is NOT
permitted.

#### Scenario: Zoomed diagram clipping
- **WHEN** the diagram is zoomed in beyond the viewport bounds
- **THEN** portions outside the viewport SHALL be clipped (not visible)

#### Scenario: Default viewport height
- **WHEN** a Mermaid diagram is rendered on a screen where `50vh` falls between 240px and 640px
- **THEN** the viewport height SHALL be `50vh`

#### Scenario: Viewport height on a short screen
- **WHEN** `50vh` would be below 240px
- **THEN** the viewport height SHALL be 240px

#### Scenario: Viewport height on a tall screen
- **WHEN** `50vh` would exceed 640px
- **THEN** the viewport height SHALL be 640px

#### Scenario: Viewport height is stable under zoom
- **WHEN** the user zooms in
- **THEN** the viewport's own height SHALL NOT change, and the enlarged diagram SHALL be reachable by panning

#### Scenario: Initial view is fitted
- **WHEN** a diagram is first rendered
- **THEN** it SHALL be displayed at the contain scale, `min(widthRatio, heightRatio)`

#### Scenario: Height-constrained diagram
- **WHEN** a diagram is taller relative to the viewport than it is wide
- **THEN** the fitted scale SHALL be the height ratio, so the diagram's full height is visible

#### Scenario: Reset returns to the fitted view
- **WHEN** the user resets a zoomed diagram
- **THEN** it SHALL return to the fitted scale rather than to a raw scale of 1

#### Scenario: Fitted scale honours the zoom bounds
- **WHEN** a diagram is large enough that fitting it would require a scale below the minimum zoom bound
- **THEN** the fitted scale SHALL be clamped to that bound rather than widening it

#### Scenario: Diagram type without max-width fitting
- **WHEN** a diagram of a type that is not configured with `useMaxWidth` is rendered
- **THEN** it SHALL still be fitted to the viewport

### Requirement: Zoom and pan state SHALL survive application re-renders
A diagram's zoom scale, pan offset and focused state SHALL persist across
re-renders of any ancestor component. No ancestor re-render SHALL discard it.
(This constrains re-render behaviour only; it does not specify when deliberate
user actions such as reset or unfocus may clear the state.)

#### Scenario: Zoom survives an application-wide re-render
- **WHEN** the user has zoomed a diagram and an unrelated application re-render occurs
- **THEN** the diagram SHALL remain at the user's scale and pan offset

#### Scenario: Focus survives an application-wide re-render
- **WHEN** the user has clicked a diagram to focus it and an unrelated application re-render occurs
- **THEN** the diagram SHALL remain focused and its zoom controls SHALL remain visible

#### Scenario: Controls remain usable under repeated re-renders
- **WHEN** the user focuses a diagram while the application re-renders repeatedly
- **THEN** the zoom controls SHALL remain visible and operable
