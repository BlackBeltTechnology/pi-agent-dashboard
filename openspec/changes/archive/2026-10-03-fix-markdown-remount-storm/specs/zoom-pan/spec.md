## MODIFIED Requirements

### Requirement: Bounded scaling

The zoom-pan state SHALL keep the scale within a configurable minimum and maximum, defaulting to a minimum of 0.5 and a maximum of 4. It SHALL start at a configurable initial scale with no translation, defaulting to a scale of 1 when no initial scale is supplied. A supplied initial scale SHALL be clamped into the configured bounds rather than widening them.

#### Scenario: Initial state

- **WHEN** the zoom-pan state is first created with no initial scale supplied
- **THEN** the scale is 1 and both the horizontal and vertical translation are 0

#### Scenario: Scale clamped to bounds

- **WHEN** a zoom action would push the scale below the minimum (default 0.5) or above the maximum (default 4)
- **THEN** the scale is clamped to that bound instead of exceeding it

#### Scenario: Initial state with an initial scale

- **WHEN** the zoom-pan state is created with an initial scale supplied
- **THEN** the scale is that value and both translations are 0

#### Scenario: Initial scale outside the bounds

- **WHEN** a supplied initial scale falls below the configured minimum or above the configured maximum
- **THEN** it is clamped into the band rather than widening it

### Requirement: Button zoom controls

The zoom-pan state SHALL expose zoom-in, zoom-out, and reset actions, where zoom-in multiplies and zoom-out divides the scale by a configurable step (default 1.2), both clamped to the scale bounds; reset returns the view to the configured initial scale with no translation, which is a scale of 1 when no initial scale is supplied.

#### Scenario: Zoom in

- **WHEN** the zoom-in action is invoked
- **THEN** the scale is multiplied by the step (default 1.2), clamped to the maximum

#### Scenario: Zoom out

- **WHEN** the zoom-out action is invoked
- **THEN** the scale is divided by the step (default 1.2), clamped to the minimum

#### Scenario: Reset

- **WHEN** the reset action is invoked, or the surface is double-clicked, and no initial scale was supplied
- **THEN** the scale returns to 1 and the translation returns to 0

#### Scenario: Reset with an initial scale

- **WHEN** the reset action is invoked, or the surface is double-clicked, and an initial scale was supplied
- **THEN** the scale returns to that initial scale and the translation returns to 0

### Requirement: On-surface control buttons

The zoom controls component SHALL render zoom-in, zoom-out, and reset buttons wired to the corresponding zoom-pan actions, and SHALL display the current zoom percentage only when the scale differs from the surface's initial scale — which is 1 for a surface that supplies no initial scale. Interactions on the controls SHALL not start a pan on the underlying surface.

#### Scenario: Buttons trigger actions

- **WHEN** the user clicks the zoom-in, zoom-out, or reset button
- **THEN** the matching zoom-in, zoom-out, or reset action is invoked

#### Scenario: Percentage indicator visibility

- **WHEN** the scale is not equal to the surface's initial scale
- **THEN** the current scale is shown as a rounded percentage
- **AND** when the scale equals the surface's initial scale no percentage is shown

#### Scenario: Percentage indicator on a surface with no initial scale

- **WHEN** a surface supplies no initial scale and the scale equals 1
- **THEN** no percentage is shown, unchanged from previous behaviour

#### Scenario: Controls do not pan the surface

- **WHEN** a pointer is pressed on the controls region
- **THEN** the event does not propagate to start a pan on the surface

## ADDED Requirements

### Requirement: The initial scale SHALL NOT alter zoom, pan or clamping behaviour

Supplying an initial scale SHALL be additive. Wheel zoom, pinch zoom, drag panning and scale clamping SHALL behave identically whether or not one is supplied.

#### Scenario: Wheel zoom with an initial scale supplied

- **WHEN** an initial scale is supplied and the user wheel-zooms
- **THEN** zoom remains anchored to the cursor and bounded by the configured scale band

#### Scenario: Drag panning with an initial scale supplied

- **WHEN** an initial scale is supplied and the user drags
- **THEN** panning follows the drag exactly as it does without one

#### Scenario: Existing consumers are unaffected

- **WHEN** a consumer that supplies no initial scale uses the zoom-pan state
- **THEN** its zoom, pan, reset and indicator behaviour is unchanged
