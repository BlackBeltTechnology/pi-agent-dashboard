# client-utils-focus-ring Specification

## Purpose
Define the shared `.focus-ring` focus-visibility utility. Scoped to `:focus-visible`, ≥2px thickness, ≥3:1 contrast across themes. Replaces the ad-hoc `focus:outline-none` + 1px border pattern (WCAG 2.2 §2.4.7 / §2.4.11).
## Requirements
### Requirement: Shared focus-ring utility meets WCAG focus appearance

The client SHALL provide a single `.focus-ring` utility (scoped to `:focus-visible`) with a visible indicator of at least 2px effective thickness and at least 3:1 contrast against adjacent colors in all four themes (studio, earth, athlete, gradient), exported as a `focusRing` className from `client-utils`. It SHALL replace the ad-hoc `focus:outline-none` + 1px `focus:border-*` pattern on covered controls.

#### Scenario: Keyboard focus shows the ring

- **WHEN** a control using `.focus-ring` receives keyboard focus (`:focus-visible`)
- **THEN** a visible focus indicator SHALL appear with ≥2px thickness and ≥3:1 contrast

#### Scenario: Mouse click does not show the ring

- **WHEN** the same control is clicked with a pointer
- **THEN** the focus ring SHALL NOT appear (`:focus-visible` semantics)

#### Scenario: Covered inputs adopt the utility

- **WHEN** the folder/session search inputs and the composer textarea/Send button render
- **THEN** they SHALL use `.focus-ring`
- **AND** SHALL NOT rely on a bare 1px `focus:border-*` swap as the only focus indicator

