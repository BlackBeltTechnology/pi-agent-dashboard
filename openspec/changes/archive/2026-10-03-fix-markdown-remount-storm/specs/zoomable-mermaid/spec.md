## ADDED Requirements

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

## MODIFIED Requirements

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
