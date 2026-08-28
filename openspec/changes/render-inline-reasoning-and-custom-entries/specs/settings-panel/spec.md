## ADDED Requirements

### Requirement: Reasoning sub-controls SHALL be grouped and visible when reasoning is off
The View settings page SHALL group the reasoning sub-controls (auto-collapse delay, keep-open-until-turn-ends, inline flow) together under the reasoning toggle inside the existing gated group. When `reasoning` is off, the sub-controls SHALL remain visible in a disabled state rather than being hidden, so the controls are discoverable. The `reasoningInlineFlow` toggle SHALL join this group and SHALL be disabled when `reasoning` is off.

#### Scenario: Sub-controls visible but disabled when reasoning is off
- **WHEN** `reasoning` is `false` on the View settings page
- **THEN** the auto-collapse, keep-open-until-turn-ends, and inline-flow controls SHALL all render (not be hidden) in a disabled state

#### Scenario: Sub-controls enabled when reasoning is on
- **WHEN** `reasoning` is `true` on the View settings page
- **THEN** the three reasoning sub-controls SHALL render enabled and reflect the effective preference values

### Requirement: Custom-entry fallback control on the View page
The View settings page SHALL provide a toggle for the `customEntryFallback` preference, placed with the extension-visibility controls (adjacent to the extension-notifications control). The toggle SHALL honor the global and per-session override plumbing, including the View popover's instant-apply semantics when surfaced there.

#### Scenario: Toggling the fallback applies to the chat
- **WHEN** the user toggles the custom-entry fallback control
- **THEN** the preference SHALL persist per the global/override draft-source rules
- **AND** custom-entry rows in the open session SHALL appear or disappear accordingly
