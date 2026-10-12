## MODIFIED Requirements

### Requirement: On-surface control buttons

The zoom controls component SHALL render zoom-in, zoom-out, and reset buttons wired to the corresponding zoom-pan actions, and SHALL display the current zoom percentage only when the scale differs from the surface's initial scale — which is 1 for a surface that supplies no initial scale. Interactions on the controls SHALL not start a pan on the underlying surface. Each button SHALL have an accessible name and a matching `title` ("Zoom in", "Zoom out", "Reset zoom" by default), taken from an optional `labels` prop so hosts with i18n pass translated strings; button icons SHALL be `aria-hidden`. Buttons SHALL measure at least 44×44 px below the `sm` breakpoint and at least 32×32 px from `sm` up (`ui-contract.md` tap-target), with the `--focus-ring` indicator on keyboard focus. The percentage SHALL use `--text-secondary` at 11 px or larger inside an `aria-live="polite"` element. This applies to every host (`MermaidBlock`, `DiagramPreview`, `FlowGraph`, team-app).

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

#### Scenario: Buttons have accessible names
- **WHEN** the zoom controls render with no label props
- **THEN** the buttons' accessible names and titles are "Zoom in", "Zoom out" and "Reset zoom", and each icon is `aria-hidden`

#### Scenario: Host passes translated labels
- **WHEN** `MermaidBlock` renders the zoom controls with the UI language set to Hungarian
- **THEN** the buttons' accessible names and titles are the Hungarian strings

#### Scenario: Targets and readout meet the contract
- **WHEN** the controls render zoomed in, at 375 px and at 1440 px
- **THEN** every button measures at least 44×44 px at 375 px and at least 32×32 px at 1440 px, and the readout is at least 11 px in `--text-secondary` inside an `aria-live="polite"` element
