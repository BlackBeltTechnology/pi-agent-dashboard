# zoom-pan Specification

## Purpose

Provide reusable zoom and pan interaction state for scrollable diagram surfaces (e.g. Mermaid diagrams, flow graphs), together with on-surface control buttons. Users can zoom with the mouse wheel, pinch, or buttons; pan by dragging; and reset to the default view, while the scale stays within fixed bounds.

## Requirements

### Requirement: Bounded scaling

The zoom-pan state SHALL keep the scale within a configurable minimum and maximum, defaulting to a minimum of 0.5 and a maximum of 4, and it SHALL start at a scale of 1 with no translation.

#### Scenario: Initial state

- **WHEN** the zoom-pan state is first created
- **THEN** the scale is 1 and both the horizontal and vertical translation are 0

#### Scenario: Scale clamped to bounds

- **WHEN** a zoom action would push the scale below the minimum (default 0.5) or above the maximum (default 4)
- **THEN** the scale is clamped to that bound instead of exceeding it

### Requirement: Button zoom controls

The zoom-pan state SHALL expose zoom-in, zoom-out, and reset actions, where zoom-in multiplies and zoom-out divides the scale by a configurable step (default 1.2), both clamped to the scale bounds; reset returns the view to scale 1 with no translation.

#### Scenario: Zoom in

- **WHEN** the zoom-in action is invoked
- **THEN** the scale is multiplied by the step (default 1.2), clamped to the maximum

#### Scenario: Zoom out

- **WHEN** the zoom-out action is invoked
- **THEN** the scale is divided by the step (default 1.2), clamped to the minimum

#### Scenario: Reset

- **WHEN** the reset action is invoked, or the surface is double-clicked
- **THEN** the scale returns to 1 and the translation returns to 0

### Requirement: Cursor-anchored wheel and pinch zoom

The zoom-pan state SHALL zoom toward a focal point so that the content under the cursor (wheel) or the midpoint between two touch points (pinch) stays fixed on screen, adjusting translation accordingly. Wheel and pinch input SHALL suppress the browser's default handling.

#### Scenario: Wheel zoom anchored to cursor

- **WHEN** the user scrolls the wheel over the surface
- **THEN** the default page scroll is prevented
- **AND** the scale changes proportionally to the wheel delta and the point under the cursor remains fixed in place

#### Scenario: Two-finger pinch zoom

- **WHEN** two touch points move on the surface
- **THEN** the default touch behavior is prevented
- **AND** the scale changes by the ratio of the current to previous finger distance, anchored at the midpoint between the two fingers

#### Scenario: No-op zoom leaves state unchanged

- **WHEN** a zoom action resolves to the same scale already in effect (already at a bound)
- **THEN** the translation is left unchanged

### Requirement: Drag to pan with click threshold

The zoom-pan state SHALL pan by translating the content in step with primary-button pointer drags, and it SHALL only begin panning once the pointer moves more than a fixed threshold (4 CSS px) from the press point, so that presses that stay within the threshold remain clicks for underlying elements.

#### Scenario: Small movement stays a click

- **WHEN** the primary button is pressed and the pointer moves no more than 4 px before release
- **THEN** no panning occurs and the press is delivered as a click to the element under the pointer

#### Scenario: Movement past threshold pans

- **WHEN** the primary button is pressed and the pointer moves more than 4 px
- **THEN** panning begins, the pointer is captured, and the translation follows the pointer including the full accumulated movement from the press point

#### Scenario: Non-primary button ignored

- **WHEN** a non-primary pointer button is pressed
- **THEN** no pan is started

### Requirement: On-surface control buttons

The zoom controls component SHALL render zoom-in, zoom-out, and reset buttons wired to the corresponding zoom-pan actions, and SHALL display the current zoom percentage only when the scale differs from 1. Interactions on the controls SHALL not start a pan on the underlying surface.

#### Scenario: Buttons trigger actions

- **WHEN** the user clicks the zoom-in, zoom-out, or reset button
- **THEN** the matching zoom-in, zoom-out, or reset action is invoked

#### Scenario: Percentage indicator visibility

- **WHEN** the scale is not equal to 1
- **THEN** the current scale is shown as a rounded percentage
- **AND** when the scale equals 1 no percentage is shown

#### Scenario: Controls do not pan the surface

- **WHEN** a pointer is pressed on the controls region
- **THEN** the event does not propagate to start a pan on the surface
